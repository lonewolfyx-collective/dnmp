# dnmp

交互式 CLI：对项目执行语义化版本升级，并将版本变更同步到相关文件、Git tag、npm 发布 / PR 流程。

## 使用

```bash
# 交互式（默认全流程：写版本 → commit → tag → 推送 → npm publish）
dnmp

# 显式指定升级类型，跳过交互
dnmp --release minor

# 预览模式：只展示计划动作，不写文件、不执行 git / npm
dnmp --release patch --dry-run

# 只改版本并本地提交，不推送、不发布
dnmp --release patch --no-git --no-submit

# 以 PR 形式提交版本升级（tag 本地创建但不推送，发布照常执行）
dnmp --release minor --pr
```

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--release <type>` | 无（交互选择） | `major` / `minor` / `patch` / `next` / `rc` / `beta-major` / `beta-minor` / `beta-patch` / `pre-beta` / `alpha-beta` / `alpha-major` / `alpha-minor` / `alpha-patch` / `date-version` |
| `--tag` / `--no-tag` | `true` | 是否创建 git tag（仅默认分支）。单包与多包版本一致 → `vX.Y.Z`；多包版本不一致 → `scope@vX.Y.Z` 每包一个 |
| `--submit` / `--no-submit` | `true` | 是否执行 `npm publish`（monorepo 逐包执行，单个失败立即中止） |
| `--git` / `--no-git` | `true` | 是否推送 commit 与 tag 到远程（`--pr` 时无效） |
| `--pr` / `--no-pr` | `false` | 以 PR 形式提交版本升级（`gh pr create`），分支 `release/vX.Y.Z`（单包）/ `release/monorepo-{随机数}`（monorepo）；开启后 tag 不推送，发布照常执行 |
| `--files <files...>` | `package.json` `package-lock.json` `jsr.json` `jsr.jsonc` `deno.json` `deno.jsonc` | 需要同步版本号的文件列表（空格或逗号分隔），传入即覆盖默认 |
| `--npmTag <tag>` | `latest` | npm 发布的 dist-tag（与 `--tag` 的 git tag 无关）；预发布版本未显式指定时自动映射为预发布标识（如 `2.0.0-rc.1` → `rc`） |
| `--opt <opt>` | 空 | `npm publish` 附加参数；`dnmp.config` 的 `env.opt` 存在时优先 |
| `--dry-run` | `false` | 预览模式 |

## 行为说明

- **项目识别**：自动识别单包 / monorepo（`pnpm-workspace.yaml` 与 npm `workspaces` 字段均支持）；`private: true` 的包不升级、不打 tag、不发布。
- **monorepo 交互**：改动前各包版本一致时只交互一次并同步更新 workspace 内部依赖区间；版本不一致时逐包选择。
- **前置校验**：git 仓库、工作区干净、当前在默认分支、tag 不存在；`--pr` 校验 gh 认证；`--submit` 校验 npm 登录。
- **配置优先级**：CLI 参数 > `dnmp.config`（c12）> 内置默认值；`--opt` 例外，`env.opt` 优先。
- **CI 模式**：检测到 `CI` / `GITHUB_ACTIONS` 时禁用交互，必须显式传 `--release`。
- **token**：不通过命令行传递，使用 `.npmrc` 或 `NODE_AUTH_TOKEN`。

详细需求见 [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md)。

## License

[MIT](./LICENSE) License © [lonewolfyx](https://github.com/lonewolfyx)
