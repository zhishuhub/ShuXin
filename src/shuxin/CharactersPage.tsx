/**
 * 选角色：一排现成角色、导入的酒馆角色卡，或者不选角色让 TA 第一次聊天时问你。
 * 换角色时，和上一个角色的聊天记忆会收起来，换回来时还在。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { CharacterView, CompanionGender, CompanionSelection } from '@shared/shuxin/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readFileAsBase64, shuxinApi } from './api';
import { useShuxin } from './context';

const GENDER_LABEL: Record<CompanionGender, string> = { female: '女朋友', male: '男朋友' };

const IMPORT_ERRORS: Record<string, string> = {
  unsupported_file: '只支持酒馆角色卡的 PNG 或 JSON 文件',
  no_card_data: '这张图片里没有角色卡数据。图床或聊天软件转发会压缩掉，请用原文件',
  invalid_card: '这张角色卡的内容读不出来',
};

export function Avatar({ character, size = 'md' }: { character: CharacterView | null; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-24 w-24 text-3xl' : 'h-16 w-16 text-xl';
  if (character?.avatar) {
    return <img src={character.avatar} alt={character.name} className={cn(box, 'shrink-0 rounded-2xl object-cover')} />;
  }
  return (
    <div className={cn(box, 'flex shrink-0 items-center justify-center rounded-2xl bg-black/5 font-serif dark:bg-white/10')}>
      {character ? character.name.slice(0, 1) : '♡'}
    </div>
  );
}

export function CharactersPage({ firstRun = false }: { firstRun?: boolean }) {
  const { overview, setOverview } = useShuxin();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [characters, setCharacters] = useState<CharacterView[]>([]);
  const [pending, setPending] = useState<{ selection: CompanionSelection; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCharacters(await shuxinApi.characters());
    } catch (error) {
      toast.error(`读取角色失败：${String(error instanceof Error ? error.message : error)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = overview.selection;
  const isCurrent = (selection: CompanionSelection) =>
    !!current && current.characterId === selection.characterId
    && (selection.characterId !== null || current.gender === selection.gender);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const next = await shuxinApi.select(pending.selection);
      setOverview(next);
      toast.success(`已换成${pending.label}`);
      setPending(null);
      navigate('/');
    } catch (error) {
      toast.error(`换角色失败：${String(error instanceof Error ? error.message : error)}`);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const result = await shuxinApi.importCard(file.name, await readFileAsBase64(file));
      if (!result.ok) {
        toast.error(IMPORT_ERRORS[result.reason] ?? '导入失败');
        return;
      }
      toast.success(`已导入「${result.character.name}」`);
      await load();
    } catch (error) {
      toast.error(`导入失败：${String(error instanceof Error ? error.message : error)}`);
    }
  };

  const toggleGender = async (character: CharacterView) => {
    const next = character.gender === 'female' ? 'male' : 'female';
    setOverview(await shuxinApi.setCharacterGender(character.id, next));
    await load();
  };

  const remove = async (character: CharacterView) => {
    if (await shuxinApi.removeCharacter(character.id)) await load();
    else toast.error('正在用的角色不能删除，先换成别的角色');
  };

  const presets = characters.filter((item) => item.source === 'preset');
  const imported = characters.filter((item) => item.source === 'imported');

  const renderCard = (character: CharacterView) => {
    const selection: CompanionSelection = { characterId: character.id, gender: character.gender };
    const active = isCurrent(selection);
    return (
      <div
        key={character.id}
        className={cn(
          'flex gap-4 rounded-2xl border p-4 text-left transition-colors',
          active ? 'border-primary bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/10',
        )}
      >
        <button type="button" className="flex flex-1 gap-4 text-left" onClick={() => setPending({ selection, label: `「${character.name}」` })}>
          <Avatar character={character} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{character.name}</span>
              <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-muted-foreground dark:bg-white/10">
                {GENDER_LABEL[character.gender]}
              </span>
              {active && <span className="shrink-0 text-xs text-primary">正在用</span>}
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{character.tagline}</p>
          </div>
        </button>
        {character.source === 'imported' && (
          <div className="flex shrink-0 flex-col gap-1">
            <Button variant="ghost" size="sm" onClick={() => void toggleGender(character)}>
              改成{GENDER_LABEL[character.gender === 'female' ? 'male' : 'female']}
            </Button>
            {!active && (
              <Button variant="ghost" size="sm" onClick={() => void remove(character)}>删除</Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8 pb-24">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-normal tracking-tight">{firstRun ? '选一个 TA' : '换个角色'}</h1>
        <p className="text-muted-foreground">
          挑一个现成的角色，或者导入你的酒馆角色卡；也可以不选，让 TA 第一次聊天时问你喜欢什么样的。
          {!firstRun && '换角色后，和之前那位的聊天记忆会收起来，换回来时还在。'}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">让 TA 自己问你</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['female', 'male'] as const).map((gender) => {
            const selection: CompanionSelection = { characterId: null, gender };
            const active = isCurrent(selection);
            return (
              <button
                key={gender}
                type="button"
                className={cn(
                  'flex items-center gap-4 rounded-2xl border p-4 text-left transition-colors',
                  active ? 'border-primary bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/10',
                )}
                onClick={() => setPending({ selection, label: `一个由你来定的${GENDER_LABEL[gender]}` })}
              >
                <Avatar character={null} />
                <div className="space-y-1">
                  <div className="font-medium">
                    {GENDER_LABEL[gender]}
                    {active && <span className="ml-2 text-xs text-primary">正在用</span>}
                  </div>
                  <p className="text-sm text-muted-foreground">名字、性格第一次聊天时一起定</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">现成角色</h2>
        <div className="grid gap-3 sm:grid-cols-2">{presets.map(renderCard)}</div>
        <p className="text-xs text-muted-foreground">
          现成角色由 Foreverse Team（foreverse.app）创作，按 CC BY 4.0 授权使用。
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">我导入的角色卡</h2>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>导入酒馆角色卡</Button>
          <input
            ref={fileInput}
            type="file"
            accept=".png,.json,image/png,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </div>
        {imported.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">{imported.map(renderCard)}</div>
        ) : (
          <p className="text-sm text-muted-foreground">支持酒馆（SillyTavern）的 PNG 角色卡和 JSON 角色卡。</p>
        )}
      </section>

      {pending && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
            <p className="flex-1 text-sm">
              换成{pending.label}？
              {current && !isCurrent(pending.selection) && <span className="text-muted-foreground"> 现在的聊天记忆会收起来，换回来时还在。</span>}
            </p>
            <Button variant="ghost" onClick={() => setPending(null)} disabled={busy}>取消</Button>
            <Button onClick={() => void confirm()} disabled={busy}>{busy ? '正在换…' : '确定'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
