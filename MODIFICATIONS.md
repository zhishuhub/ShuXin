# 枢心对 ClawX 的修改

枢心基于 [ClawX](https://github.com/ValueCell-ai/ClawX)（MIT）修改，修改后的源码在 [zhishuhub/ShuXin](https://github.com/zhishuhub/ShuXin) 的 `zhishu` 分支。

ClawX 原有功能的代码保留不删，由开关 `ZHISHU_MANAGED_AI`（`electron/shuxin/managed.ts`，默认打开）控制：打开时界面只显示枢心的几页，关闭时（`ZHISHU_MANAGED_AI=0`）恢复 ClawX 原行为，原项目的单元测试按关闭跑（`tests/setup.ts`）。

## 新增

| 位置 | 内容 |
|---|---|
| `electron/shuxin/` | 接入智枢（接入码换地址和密钥）、服务商写入、角色库、角色卡转人设、人设文件与记事本切换、微信连接状态、每日问候、托盘 |
| `electron/extensions/builtin/shuxin.ts` | 把枢心功能注册成界面可调用的 host API（模块名 `shuxin`） |
| `shared/shuxin/types.ts` | 界面和主进程共用的类型 |
| `src/shuxin/` | 枢心界面：接入、选角色、微信扫码、主页 |
| `resources/shuxin/characters/` | 7 个现成角色卡，Foreverse Team 创作，CC BY 4.0，署名见同目录 `ATTRIBUTION.md` |
| `resources/skills/girlfriend`、`resources/skills/boyfriend` | ClawHub 上的恋人技能（作者 ivangdavila，MIT-0），按当前角色只开一个 |
| `resources/icons/` | 枢心图标、托盘状态图标（`scripts/zhishu-tray-icons.mjs` 生成） |
| `electron-builder.zhishu.yml` | 枢心打包配置（继承原配置，改名、中文安装界面、不发布到 ClawX 更新源） |
| `.github/workflows/zhishu-release.yml` | 推 `v*-zs.*` 标签打 Windows（x64）安装程序和 Mac（Apple 芯片）dmg 并发 Release |

## 改动的原文件

| 文件 | 改动 |
|---|---|
| `electron/main/index.ts` | 开关打开时：用枢心托盘；不写 ClawX 的身份和上下文文件；`--hidden` 启动不弹窗口；Windows 应用 ID 改为枢心的 |
| `electron/main/launch-at-startup.ts` | 开机自启带 `--hidden` |
| `electron/utils/store.ts` | 开关打开时默认开机自启、不上报统计、不检查 ClawX 更新 |
| `electron/utils/skill-config.ts` | 内置技能多两个恋人技能 |
| `electron/extensions/builtin/index.ts`、`clawx-extensions.json` | 注册枢心扩展 |
| `electron/preload/index.ts`、`src/types/electron.d.ts`、`src/main.tsx` | 把开关传给界面，打开时渲染枢心界面 |
| `index.html`、`package.json` | 窗口标题、版本号（`0.7.0-zs.2`） |
| `.github/workflows/release.yml` | 原发布流程不响应 `v*-zs.*` 标签 |
| `tests/setup.ts` | 测试里关掉开关 |
