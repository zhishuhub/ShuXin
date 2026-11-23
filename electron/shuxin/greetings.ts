/**
 * 每日主动问候：早上一条、晚上一条，用 OpenClaw 的定时任务发到对方微信。
 * 一天只发两条：腾讯的微信通道短时间内连续推送会被限流，主动消息也不宜多。
 */
import type { CompanionSkill } from './companion-workspace';

export interface GatewayRpc {
  rpc<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
}

export interface GreetingTarget {
  agentId: string;
  accountId: string;
  userId: string;
}

const NAME_PREFIX = '枢心·';

export interface GreetingSpec {
  name: string;
  expr: string;
  message: string;
}

export function greetingSpecs(skill: CompanionSkill): GreetingSpec[] {
  const memory = `~/${skill}/`;
  return [
    {
      name: `${NAME_PREFIX}早安`,
      expr: '30 8 * * *',
      message: [
        `现在是早上。先读 ${memory} 里的记事本（moments.md、history.md、bond.md），`,
        '按你的人设给对方发一条早安微信：一两句，提到一件你记得的、和对方今天有关的具体小事，最后可以问一个轻松的问题。',
        '如果记事本里写着对方不想被主动打扰，或者对方最近一次说了今天很忙别打扰，就只回复 NO_REPLY。',
      ].join(''),
    },
    {
      name: `${NAME_PREFIX}晚安`,
      expr: '30 22 * * *',
      message: [
        `现在是晚上。先读 ${memory} 里的记事本，`,
        '按你的人设给对方发一条晚安微信：一两句，语气放软，可以接着白天聊过的事。',
        '如果记事本里写着对方不想被主动打扰，就只回复 NO_REPLY。',
      ].join(''),
    },
  ];
}

interface CronJobSummary {
  id?: string;
  name?: string;
}

function listJobs(result: unknown): CronJobSummary[] {
  if (Array.isArray(result)) return result as CronJobSummary[];
  if (result && typeof result === 'object' && Array.isArray((result as { jobs?: unknown }).jobs)) {
    return (result as { jobs: CronJobSummary[] }).jobs;
  }
  return [];
}

/** 先删掉枢心以前建的问候任务，再按当前角色和微信账号重建，换角色、重新扫码后都调一次。 */
export async function syncGreetingJobs(
  gateway: GatewayRpc,
  target: GreetingTarget | null,
  skill: CompanionSkill,
  timeZone: string,
): Promise<void> {
  const existing = listJobs(await gateway.rpc<unknown>('cron.list', { includeDisabled: true }));
  for (const job of existing) {
    if (job.id && job.name?.startsWith(NAME_PREFIX)) {
      await gateway.rpc('cron.remove', { id: job.id });
    }
  }
  if (!target || !target.userId) return;
  for (const spec of greetingSpecs(skill)) {
    await gateway.rpc('cron.add', {
      name: spec.name,
      schedule: { kind: 'cron', expr: spec.expr, tz: timeZone },
      payload: { kind: 'agentTurn', message: spec.message },
      enabled: true,
      wakeMode: 'next-heartbeat',
      sessionTarget: 'isolated',
      agentId: target.agentId,
      delivery: { mode: 'announce', channel: 'openclaw-weixin', to: target.userId, accountId: target.accountId },
    });
  }
}
