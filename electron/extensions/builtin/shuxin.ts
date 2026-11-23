/**
 * 枢心扩展：把枢心的主进程功能注册成界面能调用的 host API（模块名 shuxin）。
 * 只在接入开关打开时加载（见 builtin/index.ts）。
 */
import type { HostApiContribution, RuntimeHostAction } from '../../main/ipc/host-contract';
import type { CompanionGender, CompanionSelection } from '../../shuxin/characters';
import { ShuxinService } from '../../shuxin/service';
import type { Extension, ExtensionContext, HostApiProviderExtension } from '../types';

let activeService: ShuxinService | null = null;

/** 主进程其它地方（托盘、启动流程）拿到同一个服务实例。 */
export function getShuxinService(): ShuxinService | null {
  return activeService;
}

function record(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

function gender(value: unknown): CompanionGender {
  return value === 'male' ? 'male' : 'female';
}

class ShuxinExtension implements HostApiProviderExtension {
  readonly id = 'builtin/shuxin';
  private service: ShuxinService | null = null;

  private ensureService(ctx: ExtensionContext): ShuxinService {
    if (!this.service) {
      this.service = new ShuxinService(ctx.gatewayManager, ctx.getMainWindow);
      activeService = this.service;
    }
    return this.service;
  }

  setup(ctx: ExtensionContext): void {
    this.ensureService(ctx).start();
  }

  teardown(): void {
    this.service?.stop();
    activeService = null;
  }

  getHostApiContributions(ctx: ExtensionContext): HostApiContribution[] {
    const service = this.ensureService(ctx);
    const actions: Record<string, RuntimeHostAction> = {
      overview: () => service.overview(),
      connect: (payload) => service.connect(String(record(payload).code ?? '')),
      clipboardCode: () => service.clipboardCode(),
      disconnect: () => service.disconnect(),
      characters: () => service.listCharacters(),
      importCard: (payload) => {
        const body = record(payload);
        return service.importCard({
          fileName: String(body.fileName ?? ''),
          dataBase64: String(body.dataBase64 ?? ''),
          gender: body.gender === undefined ? undefined : gender(body.gender),
        });
      },
      setCharacterGender: (payload) => {
        const body = record(payload);
        return service.setCharacterGender(String(body.id ?? ''), gender(body.gender));
      },
      removeCharacter: (payload) => service.removeCharacter(String(record(payload).id ?? '')),
      select: (payload) => {
        const body = record(payload);
        const selection: CompanionSelection = {
          characterId: typeof body.characterId === 'string' && body.characterId ? body.characterId : null,
          gender: gender(body.gender),
        };
        return service.select(selection);
      },
      afterWeChatLogin: () => service.afterWeChatLogin(),
      openSite: (payload) => {
        service.openSite(String(record(payload).path ?? ''));
        return true;
      },
    };
    return [{ module: 'shuxin', actions }];
  }
}

export function createShuxinExtension(): Extension {
  return new ShuxinExtension();
}
