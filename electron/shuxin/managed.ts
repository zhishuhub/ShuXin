/**
 * 枢心开关与常量。
 *
 * ZHISHU_MANAGED_AI 为真时：AI 服务只用智枢接入码换来的地址和密钥，界面只保留枢心的几页，
 * ClawX 原有的服务商配置、聊天页、智能体、电脑操控等功能代码保留不删，只是不显示、不启用，方便以后合并上游。
 * 只有原项目的单元测试会设 ZHISHU_MANAGED_AI=0 跑原行为。
 */
export const ZHISHU_MANAGED_AI = process.env.ZHISHU_MANAGED_AI !== '0';

/** 智枢应用广场上本应用的编号，接入和检查更新都用它。 */
export const SHUXIN_APP_KEY = 'shuxen26';

/** 对话模型写 chat，由智枢换成当前分组里的模型，模型更新时应用不用改。 */
export const SHUXIN_CHAT_MODEL = 'chat';

/**
 * 接入后唯一的服务商账号。ClawX 把自定义服务商的账号编号截成 custom-<8 位> 当作 OpenClaw 里的服务商名，
 * 这里直接取一个本身就是这个形状的编号，两边一致。
 */
export const SHUXIN_PROVIDER_ACCOUNT_ID = 'custom-zhishu01';

/** 接入地址固定；SHUXIN_CONNECT_URL 只给本地测试用。 */
export const SHUXIN_CONNECT_URL =
  process.env.SHUXIN_CONNECT_URL?.trim() || 'https://zhishuhub.com/api/apps/connect';

/** 接入码格式：APP-XXXX-XXXX-XXXX。 */
export const SHUXIN_CODE_PATTERN = /APP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/;

/** 「关于」页的署名链接。 */
export const SHUXIN_SOURCE_URL = 'https://github.com/zhishuhub/ShuXin';
export const SHUXIN_UPSTREAM_URL = 'https://github.com/ValueCell-ai/ClawX';

/** 陪伴对象用的 OpenClaw 智能体：微信消息默认就交给它。 */
export const SHUXIN_AGENT_ID = 'main';
