# DNMP 重写 · 功能需求清单 v2

> 状态：已确认（8 项开放决策已由维护者拍板）
> 日期：2026-08-30
> 范围：只重写 `src/`（约 700 行），tsdown / eslint(antfu) / simple-git-hooks / tsconfig 工具链原样保留；`getNextVersions`（`src/version/new.version.ts`）核心逻辑先补测试再原样搬入。

---

## 1. 产品定位与总体约束

1. **产品定位**：`dnmp` 是一个交互式 CLI，对目标项目执行语义化版本升级，并将版本变更同步到相关文件、Git tag、npm 发布 / PR 流程。
2. **技术栈**：沿用当前 `package.json` 的 dependencies（cac、@clack/prompts、semver、tinyexec、find-up、glob、c12、defu、yaml、dayjs、jiti、boxen）与 devDependencies（tsdown、@antfu/eslint-config、typescript、tsx 等），不引入新依赖。
3. **版本规则**：所有版本变更遵循 semver。
4. **命令形态**：仅 `dnmp` 主命令完成 package.json 交互变更。**`dnmp set <token>` 子命令删除**；token 只通过 `.npmrc` / `NODE_AUTH_TOKEN` 提供，严禁出现在命令行参数、进程列表与日志中（旧实现曾把 token 拼进 `npm publish` 参数，必须根除）。
5. **运行环境**：Node ≥ 20.11（依赖 `import.meta.dirname`），写入 `engines` 字段。

## 2. 目标项目识别（作用域判定）

1. **识别逻辑整体重写**（现有 `isMonorepo` 存在 `indexOf('*')` 恒真、yaml 重复解析等缺陷）。从 cwd 向上查找 workspace 标识，找到即 monorepo 模式，否则单包模式。
2. **同时支持两种 workspace 形态**：
   - `pnpm-workspace.yaml`（解析 `packages` globs）；
   - 根 `package.json` 的 `workspaces` 字段（npm/yarn 风格，支持字符串数组和 `{ packages: [...] }` 对象两种写法）。
3. 子包收集：按 workspace globs 展开 `package.json`，忽略 `node_modules`。
4. **单包项目（优先场景）**：bump 根 package.json 版本后走完整流程。
5. **monorepo 项目**：**忽略根 package.json 的 version**，按各子包的 package.json 进行版本变更与发布（根包通常 private，天然被下条过滤）。
6. **private 过滤**：`private: true` 的包完全跳过——不 bump、不 tag、不发布、不进入交互选择。

## 3. 版本交互规则（场景矩阵）

| 场景 | 版本交互 | 依赖区间同步 |
|---|---|---|
| 单包 | 单次交互：展示 `旧版本 → 新版本`，允许手动改写 | 不适用 |
| monorepo，所有非 private 包**改动前版本一致** | **只交互一次**，统一的 release 类型应用到全部选中包 | **同步更新** workspace 内其他包对该包的依赖区间（如 `^x.y.z`） |
| monorepo，非 private 包**改动前版本不一致** | 使用 `@clack/prompts` 的 `task` **逐包交互**选择 release 类型 / 确认版本，确认完再统一执行 | 不做自动同步，保持原区间 |

- 所有参数均有默认值，交互支持一路回车走默认。
- `--release` 未传时交互式选择；传了非法值直接报错退出。

## 4. CLI 参数定义

| 参数 | 类型 / 默认值 | 行为 |
|---|---|---|
| `--release <type>` | 枚举，无默认 | 版本升级类型，取值见 §9 releaseType 语义表。未传时交互选择；非法值报错 |
| `--tag` | boolean，默认 `true` | 是否创建 git tag。仅在仓库**默认主分支**上创建。格式规则见 §5。`false` 不打 tag |
| `--submit` | boolean，默认 `true` | 是否执行 npm 发布。单包在根目录执行；monorepo 逐个进入各包目录执行。`--pr true` 时仍立即发布（见 §6） |
| `--git` | boolean，默认 `true` | 是否将 commit 与所有 tag 推送到远程。`false` 不推送。`--pr true` 时此参数**无效**（tag 不推送） |
| `--pr` | boolean，默认 `false` | 是否以 PR 形式提交版本升级供管理员审核。**PR 仅作创建，不影响发布时序**：`--pr true` 时 `--submit` 照常立即发布；tag 仍按 `--tag` 在本地创建，但**不推送**（`--git` 无效）。命令模板见 §6 |
| `--files <string[]>` | 数组，可缺省 | 需要同步写入新版本号的文件，默认 `["package.json", "package-lock.json", "jsr.json", "jsr.jsonc", "deno.json", "deno.jsonc"]`；传入即**覆盖**默认列表；列表中不存在的文件跳过 |
| `--npmTag <string>` | string，默认 `latest` | npm 发布的 dist-tag（`npm publish --tag <npmTag>`）。**与 `--tag`（git tag）含义不同** |
| `--opt <string>` | string，默认 `""` | npm 发布附加参数，语义与 npmjs 官方一致。`--opt` 与 `env.opt`（dnmp env 配置）**同源同值**；生效规则：`env.opt` 存在时优先取 `env.opt`，否则取 CLI `--opt`，均无则不传 |

**配置优先级**：CLI 参数 > `dnmp.config`（c12 加载）> 内置默认值；`--opt` 按上表例外规则（env 优先）。

## 5. Git tag 规则

| 场景 | tag 格式 | 数量 |
|---|---|---|
| 单包 | `vX.Y.Z` | 1 |
| monorepo，发布后所有包版本**一致** | `vX.Y.Z` | **1**（只打一个） |
| monorepo，各包版本**不一致** | `scope@vX.Y.Z`（scope = 该包 package.json 的 `name`） | 每包 1 个 |

- 仅在当前分支为仓库默认分支时执行；非默认分支运行时提示并终止。
- `--git true`：推送默认分支的 commit 与全部 tag 到远程。
- `--pr true`：tag 照常本地创建（若 `--tag true`），但**不推送**。

## 6. PR 流程（`--pr true`）

- 前提：`gh` CLI 已安装且已认证；`--repo` 从 git remote origin 解析（owner/repo）。
- 命令模板：

  ```
  gh pr create \
    --repo <owner/repo> \
    --title "chore(release): <tag 名称>" \
    --body "<旧版本> -> <新版本>（如 1.0.0 -> 1.0.2）" \
    --draft false \
    --branch <release 分支>
  ```

- release 分支命名：
  - 单包：`release/vX.Y.Z`；
  - monorepo（含版本一致与不一致）：`release/monorepo-{随机数值}`（建议 6 位随机整数，冲突时重新生成）。
- 多包场景：创建**一个汇总 PR**，body 逐行列出各包 `旧版本 -> 新版本`；npm 发布仍各自独立执行。
- PR 分支从默认分支切出并推送到远程（`gh pr create` 的前提）；tag 不随 PR 推送。
- 待实现时确认的小项：多版本汇总 PR 的 title 中「tag 名称」取值（建议 `chore(release): monorepo`）。

## 7. npm 发布（`--submit true`）

1. 单包：项目根目录执行 `npm publish`；monorepo：**逐个**进入各包目录顺序执行。
2. 固定携带 `--access public`。
3. 携带 `--tag <npmTag>`（默认 `latest`）。
4. 生效的 `opt` 存在时追加传递（见 §4 `--opt` 行为）。
5. 失败策略（补充默认值）：逐个顺序发布，**单个失败立即中止（fail-fast）**，输出已完成 / 未完成清单。
6. 边界（建议处理）：依赖区间使用 `workspace:` 协议时，`npm publish` 无法解析——检测到时提示改用对应包管理器发布或先做协议解析。

## 8. 执行流程总览

```
1. 解析 CLI 参数（cac + parseAsync）
2. 前置校验（全部通过才继续）：
   git 仓库 / 工作区无未提交变更 / 当前在默认分支
   --pr 时：gh 已安装且已认证
   --submit 时：npm 已登录 / 目标版本未发布 / tag 不存在
3. 识别项目形态（单包 / monorepo），过滤 private 包
4. 版本计算与交互确认（按 §3 场景矩阵）
5. 写入 --files 文件（保留原缩进与尾换行；package-lock.json 同步根
   version 与 packages[""].version 两处；monorepo 在对应包目录及仓库根更新）
6. git add（--files 涉及文件）+ commit（chore(release): <tag 名>）
7. 打 git tag（--tag，按 §5 格式）
8. 分支处置：
   --git true  → 推送默认分支 commit 与全部 tag
   --pr true   → 切 release 分支 → push 分支 → gh pr create（tag 不推送）
9. npm publish（--submit，按 §7 规则逐个执行）
10. 汇总输出：各包 旧版本 → 新版本、tag、发布结果 / PR 链接（picocolors / boxen 美化）
```

- commit message 约定：`chore(release): <tag 名>`；monorepo 多版本场景建议 `chore(release): monorepo`。

## 9. releaseType 语义表

取值来源：`src/release-type.ts` 的 `releaseType` 联合类型。命名约定为「基底升级 + 预发布标识」，下表为建议语义，**带 ⚠ 的项需在实现前最终确认**（旧实现问题：`next` 与 `patch` 行为相同、`pre-beta` 会抹掉计数器、`date-version` 用本地时间）。

| 值 | 输入 → 输出示例（建议语义） |
|---|---|
| `major` | 1.2.3 → 2.0.0 |
| `minor` | 1.2.3 → 1.3.0 |
| `patch` | 1.2.3 → 1.2.4 |
| `next` ⚠ | 预发布中：1.2.3-beta.1 → 1.2.3-beta.2（递增计数器）；正式版：1.2.3 → 1.2.4-beta.0 |
| `rc` | 1.2.3 → 1.3.0-rc.0 ⚠（基底取 minor 还是 patch 待确认） |
| `beta-major` | 1.2.3 → 2.0.0-beta.0 |
| `beta-minor` | 1.2.3 → 1.3.0-beta.0 |
| `beta-patch` | 1.2.3 → 1.2.4-beta.0 |
| `pre-beta` ⚠ | 当前版本基础上加 / 递增 beta 预发布：1.2.3-beta.1 → 1.2.3-beta.2；1.2.3 → 1.2.3-beta.0（不升基底） |
| `alpha-beta` ⚠ | 1.2.3 → 1.3.0-alpha-beta.0（语义待确认） |
| `alpha-major` | 1.2.3 → 2.0.0-alpha.0 |
| `alpha-minor` | 1.2.3 → 1.3.0-alpha.0 |
| `alpha-patch` | 1.2.3 → 1.2.4-alpha.0 |
| `date-version` | 按日期生成版本（如 2026.08.30），**必须使用 UTC** |

## 10. 健壮性与安全约束（重写必须落实，源自旧实现 P0 问题）

1. `cli.parseAsync()` 启动；所有错误路径**非零退出码**（旧代码 `cli.parse()` 捕获不到 async 异常且 `exit(0)`）。
2. 所有子进程调用（tinyexec）开启 `throwOnError`，失败即时终止并回显 stderr。
3. token 不上命令行、不进日志（见 §1.4）。
4. 写文件保留原缩进与尾换行，禁止破坏 JSON 格式。
5. 若保留本地缓存机制：改 JSON 存储、写入前先 `mkdir`、提供重置手段（旧实现存 boolean、无目录、类型撒谎）。

## 11. 增强需求（评审采纳）

1. **`--dry-run`**：预览全部动作（新版本、受影响文件、commit、tag、push/publish 目标、PR）但不落盘不执行。
2. **prerelease ↔ npmTag 联动**：版本号含 prerelease 标识且用户**未显式传** `--npmTag` 时，dist-tag 自动映射为预发布标识（如 `2.0.0-rc.1` → `rc`），防止预发布版本覆盖 `latest`。
3. **CI / 非交互模式**：检测 `CI` / `GITHUB_ACTIONS` 环境时禁用交互，必需参数缺失则报错退出。
4. **汇总输出**：见 §8 第 10 步。
5. **更新检查**（可选）：提示新版本可用，低优先级。

## 12. 测试与工程质量

1. **vitest 全面覆盖**，必须同时覆盖：
   - **单包场景**：版本计算全枚举、文件写入保真、参数解析与默认值；
   - **monorepo 场景**：两种 workspace 识别（pnpm-workspace.yaml / npm workspaces）、private 过滤、版本一致（单次交互 + 依赖区间同步）与不一致（逐包交互）两条分支、tag 格式生成（单个 `vX.Y.Z` / 多个 `scope@vX.Y.Z`）。
2. git / publish 动作通过临时仓库 fixture 与 mock 验证，不发真实 npm。
3. GitHub Actions：lint + test 流水线。
4. `engines`: Node ≥ 20.11。

## 13. 决策记录（2026-08-30）

| # | 议题 | 决策 |
|---|---|---|
| 1 | monorepo 识别逻辑 | 重写；pnpm-workspace.yaml 与 npm workspaces **均支持** |
| 2 | monorepo 根 package.json | 忽略根 version，按各子包发布；发布后版本一致 → 只打 1 个 tag |
| 3 | workspace 依赖区间同步 | 改动前版本一致时：交互一次并**同步更新**依赖区间 |
| 4 | 发布顺序 | 逐个 publish；失败策略默认 fail-fast（本清单补充） |
| 5 | 测试范围 | vitest 全面覆盖，单包 + monorepo 场景 |
| 6 | `--access` | 默认 `--access public`（原文 publish 为笔误） |
| 7 | `--pr` 语义 | PR 仅作创建，**仍立即发布**；`--pr true` 时 `--git` 无效、tag 不推送 |
| 8 | `--pr` 多包 | 一个汇总 PR，发布各自独立；分支 monorepo 用 `release/monorepo-{随机数值}`，单包用 `release/vX.Y.Z` |
| 9 | 单包 tag 格式 | 单包 `vX.Y.Z`；多包一致 `vX.Y.Z`；多包不一致 `scope@vX.Y.Z` |
| 10 | workspace 识别范围 | pnpm-workspace.yaml + npm workspaces 均支持 |
| 11 | `--opt` 优先级 | `--opt` 与 `env.opt` 同源同值；`env.opt` 存在时优先 |
| 12 | `dnmp set <token>` | 删除；token 只走 `.npmrc` / `NODE_AUTH_TOKEN` |
| 13 | monorepo 交互粒度 | 改动前版本一致 → 选一次；不一致 → `@clack/prompts` `task` 逐包选择后再执行 |
