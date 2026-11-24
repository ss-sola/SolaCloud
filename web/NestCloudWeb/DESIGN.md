---
version: alpha
name: NestCloud System Design
description: |
  A unified admin interface built on Bootstrap 5.2.3 with a green-accented design system.
  Custom CSS overrides layer on top of Bootstrap defaults to establish the brand palette,
  spacing, and component styling. The sidebar pairs a contour-patterned brand card with a
  softly tinted navigation surface. It uses forest green in light mode and slate blue in
  dark mode. A fixed single-row header sits above the content canvas and rounded utility cards.
---

## Overview

NestCloud Web 是一个统一的后台管理前端，基于 **Bootstrap 5.2.3**，在其之上叠加了 **绿色强调色系统**。核心视觉区域包括**品牌侧边栏**、**单行固定顶栏**、**浅色内容画布**（Parchment 背景）和 **圆角内容卡片**。

品牌卡右侧的细等高线构成侧边栏的识别图案。菜单底色自上而下逐渐融入面板，内容区用圆角卡片承载数据表格和表单。

**Key Characteristics:**

- **单一绿色强调色** (`#22a06b`) 贯穿所有交互元素：主按钮、活跃导航项、状态徽章、焦点环
- **Bootstrap 5.2.3 为基础**，通过自定义 CSS 覆盖默认样式（按钮、输入框、模态框、分页器等）
- **侧边栏品牌卡**在浅色主题使用森林绿，深色主题使用蓝灰，两种主题共用同一等高线图案。
- **Parchment 背景** (`#edf2f7`) 作为全局底色，内容卡片为纯白 `#ffffff`
- **圆角语法**：sm=8px（按钮/输入框）、md=11px（导航项）、lg=16px（加载面板）、xxxl=22px（页面卡片）、pill=9999px（标签/搜索框）
- **字体**：Inter + PingFang SC + Microsoft YaHei，body 17px，weight 400/600/700/800（无 500）
- **单行顶栏**紧贴内容区上沿，使用主题面板底色和一条底部分隔线。
- **柔和阴影**：卡片使用 `0 20px 48px rgba(15, 23, 42, 0.08)` 营造悬浮感

## Architecture Notes

### Bootstrap as Foundation

Bootstrap 5.2.3 is imported as the base layer for:

- Grid system (`row`, `col-md-*`, `d-flex`, `gap-3`, etc.)
- Form controls (`form-control`, `form-select`, `form-check-input`, `form-label`)
- Modal structure (`modal`, `modal-dialog`, `modal-content`, `modal-header`, `modal-body`, `modal-footer`)
- Utility classes (`text-secondary`, `small`, `fw-semibold`, `text-nowrap`, `text-truncate`)
- Table base styles (`table`, `table align-middle`)

Custom CSS in `legacy-style.css` and `global.css` overrides Bootstrap defaults for:

- Color palette (green instead of Bootstrap blue)
- Border radius (custom scale instead of Bootstrap defaults)
- Shadows (softer, green-tinted)
- Sidebar layout (custom flex layout instead of Bootstrap navbar)
- Component-level refinements (buttons, badges, pagination)

### CSS File Loading Order

1. `bootstrap/dist/css/bootstrap.min.css` — base layer (loaded first, lowest specificity wins)
2. `global.css` — global resets and shared styles (loaded second)
3. `legacy-style.css` — system module custom component styles (loaded third, highest priority)
4. Module-specific CSS — loaded last

When selectors conflict, `legacy-style.css` takes priority due to load order.

---

## Colors

以下品牌、表面与组件色值描述默认的浅绿主题。深色主题与集中日志流程图共用色板，通过主题变量切换，布局、字号与间距沿用同一套规范。

| 深色用途                   | 颜色                 |
| -------------------------- | -------------------- |
| 页面画布、强调按钮上的文字 | `#0d1219`            |
| 卡片、表单和弹窗           | `#19212d`            |
| 抬高的表面、分隔边框       | `#202a38`、`#344258` |
| 正文、次要说明             | `#e4eaf3`、`#abb8ca` |
| 交互强调、选中底色         | `#85afe8`、`#263143` |

### Brand & Accent

- **Brand Green** (`#22a06b`): 唯一的品牌强调色。所有主按钮、活跃导航项、链接、焦点环、成功状态都用此色。
- **Brand Green Pressed** (`#1d8a5e`): 按下态和链接色。
- **Brand Green Soft** (`#dff3ea`): 极浅的绿色，用于活跃导航背景、hover 态、badge 底色。

### Surface

- **Canvas** (`#ffffff`): 纯白，内容卡片、表格、模态框的底色。
- **Parchment** (`#edf2f7`): 全局页面背景色，浅灰蓝调。
- **Surface Soft** (`#f8fafc`) 用于汇总面板和指标卡片。
- **Sidebar** 的浅色品牌卡从 `#123f36` 过渡到 `#347663`，菜单从 `#e3f0e9` 过渡到白色。深色主题使用现有蓝灰面板色阶。

### Text

- **Ink** (`#1f2937`): 主要文字色。
- **Ink Muted** (`#6b7280`): 次要文字、表头、元数据。
- **Ink Light** (`#9ca3af`): 占位符文字、禁用态。

### Semantic

- **Success** (`#22c55e`): 成功状态。
- **Success Soft** (`#dcfce7`): 成功 badge 背景。
- **Success Text** (`#166534`): 成功文字色。
- **Warning** (`#eab308`): 警告状态。
- **Danger** (`#ef4444`): 危险/删除操作。
- **Danger Soft** (`#fee2e2`): 危险操作背景。

### Hairlines & Shadows

- **Hairline** (`rgba(15, 23, 42, 0.08)`): 1px 边框色，用于输入框、卡片、表格分隔线。
- **Shadow Soft** (`0 20px 48px rgba(15, 23, 42, 0.08)`): 卡片的主阴影。

---

## Typography

### Font Family

- `Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif` — 全局字体栈。
- Inter 作为英文主字体，PingFang SC / Microsoft YaHei 作为中文回退。

### Hierarchy

| Token       | Size | Weight | Line Height | Use            |
| ----------- | ---- | ------ | ----------- | -------------- |
| display-xl  | 40px | 800    | 1.1         | 品牌区标题     |
| display-lg  | 32px | 800    | 1.15        | 页面主标题     |
| heading-xl  | 28px | 700    | 1.2         | 模态框标题     |
| heading-lg  | 24px | 700    | 1.25        | 区块标题       |
| heading-md  | 20px | 700    | 1.2         | 卡片标题       |
| body-strong | 17px | 600    | 1.4         | 强调正文       |
| body        | 17px | 400    | 1.5         | 默认正文       |
| body-sm     | 15px | 400    | 1.5         | 小号正文       |
| caption     | 14px | 600    | 1.3         | 标签、按钮文字 |
| caption-sm  | 12px | 600    | 1.3         | 小号标签       |
| button      | 15px | 600    | 1           | 按钮文字       |
| fine-print  | 12px | 400    | 1.4         | 法律文本       |

### Principles

- **Weight 800 用于品牌区标题**（NEST CLOUD），700 用于页面标题，600 用于正文强调和按钮。
- **Body 17px**，line-height 1.5。
- **Weight 500 不存在**，强调统一用 600。
- 当前页面组件使用浏览器默认 `<h1>`-`<h6>` 尺寸，尚未完全映射到上述 token。后续组件化时会统一。

---

## Layout

### Spacing System

- **Base unit:** 4px。所有间距都是 4 的倍数。
- **Tokens:** xxs=4px · xs=8px · sm=12px · md=16px · lg=20px · xl=24px · xxl=32px · section=48px。
- **卡片内边距:** xl (24px)。
- **侧边栏导航项:** sm (12px) 垂直 padding。
- **表格单元格:** 16px 水平 padding。

### Grid & Container

- **布局:** 280px 侧边栏 + 弹性内容区（flexbox，非 Bootstrap grid）。
- **内容最大宽度:** 无硬性限制，由浏览器视口自然撑开。
- **响应式断点:** 960px（侧边栏折叠为顶部横条）、1200px（模态框双列变单列）。

---

## Elevation & Depth

| Level       | Treatment                            | Use                              |
| ----------- | ------------------------------------ | -------------------------------- |
| Flat        | 无边框、无阴影                       | 全局背景、侧边栏品牌区           |
| Soft shadow | `0 20px 48px rgba(15, 23, 42, 0.08)` | 页面卡片、登录面板               |
| Hairline    | 1px `rgba(15, 23, 42, 0.08)`         | 输入框边框、卡片边框、表格分隔线 |

---

## Shapes

### Border Radius Scale

| Token | Value  | Use                    |
| ----- | ------ | ---------------------- |
| xs    | 5px    | 树形控件切换按钮       |
| sm    | 8px    | 按钮、输入框、分页按钮 |
| md    | 11px   | 导航项、Toast          |
| lg    | 16px   | 加载面板、侧栏品牌卡   |
| xl    | 18px   | 指标卡片               |
| xxl   | 20px   | 登录面板               |
| xxxl  | 22px   | 页面内容卡片           |
| pill  | 9999px | 标签、搜索框、信息芯片 |

---

## Components

### Navigation

**`brand-card`** — 品牌区

- 品牌卡左右留白 12px，四角半径 16px。等高线从右下角向内延伸，在标题附近淡出。
- 在 960px 及以下，卡片上下内边距缩至 16px。
- 标题 32px weight 800，副标题 16px。

**`sidebar-link`** — 导航项

- 默认项使用透明背景和 12px 圆角。
- 分组和菜单项沿用菜单配置的 16px 图标。深色主题使用浅色图标。
- 悬停和选中项使用主题强调底色。浅色主题搭配 `#165d43` 文字，深色主题使用蓝色强调文字。
- 当前页面的导航项左侧另有 3px 强调色标记。

**`sidebar-group-toggle`** — 分组折叠按钮

- 14px 圆角，`#6b7280` 文字，10px × 14px padding。
- hover：浅绿色背景 + 绿色文字。

### Topbar

**`topbar`** — 页面顶栏

- 顶栏固定在滚动区域上方，以不透明面板底色、直角和 1px 底边分隔正文。
- 桌面顶栏高 58px，标题在左，日月主题开关、头像菜单在右。登出放在头像菜单内。
- 960px 及以下使用 54px 顶栏，540px 及以下收起账号名。标题过长时显示省略号。

### Buttons

> **Note:** Buttons use Bootstrap's class system (`btn`, `btn-success`, `btn-outline-*`) but are styled by custom CSS to match the green accent palette.

**`button-primary`** — 主按钮（`btn btn-success`）

- 背景 `#22a06b`，白色文字，8px 圆角，44px 高，15px/600。
- Pressed：`#1d8a5e`。
- Hover：极浅绿色背景（`#dff3ea`）。

**`button-secondary`** — 次按钮（`btn btn-outline-success`）

- 透明背景，`#22a06b` 文字，8px 圆角，44px 高，1px 边框。

**`button-ghost`** — 幽灵按钮

- 透明背景，`#6b7280` 文字，8px 圆角，8px × 12px padding。

**`button-icon`** — 图标按钮

- 透明背景，`#6b7280` 图标，32px × 32px，8px 圆角。

### Inputs & Forms

**`text-input`** — 文本输入框（`form-control`）

- 白色背景，`#1f2937` 文字，8px 圆角，44px 高，1px 边框 `#e0e0e0`。
- Focus：2px 绿色边框 + 绿色光晕 `rgba(34, 160, 107, 0.16)`。

**`search-input`** — 搜索框

- pill 形状（9999px 圆角），44px 高，12px × 20px padding。

### Cards & Containers

**`page-card`** — 页面内容卡片

- 白色背景，22px 圆角，`0 20px 48px rgba(15, 23, 42, 0.08)` 阴影，1px 边框。
- 24px 内边距。

**`summary-panel`** — 汇总面板

- `#f8fafc` 背景，16px 圆角，1px 边框，14px × 16px padding。

**`monitor-metric-card`** — 指标卡片

- `#f8fafc` 背景，18px 圆角，1px 边框，18px padding。

### Tables

**`table-header`** — 表头

- `#f8fafc` 背景，`#6b7280` 文字，12px/600，加粗。

**`table-row-hover`** — 行 hover

- `#dff3ea` 浅绿色背景。

### Badges & Chips

**`badge-inline`** — 状态徽章

- pill 形状，`#dcfce7` 背景 + `#166534` 文字（success），或 `#e2e8f0` + `#475569`（secondary）。
- 4px × 10px padding，12px/700。

**`filter-pill`** — 筛选胶囊

- `#f8fafc` 背景，`#6b7280` 文字，pill 形状，8px × 16px padding。
- Active：`#22a06b` 背景，白色文字。

**`info-chip`** — 信息芯片

- 半透明白色背景，`#6b7280` 文字，pill 形状，10px × 14px padding，1px 边框。

### Modal

**`modal`** — 模态框

- 使用 Bootstrap 的 `modal` 结构类，自定义 22px 圆角，`0 20px 48px rgba(15, 23, 42, 0.12)` 阴影。

### Toast

**`toast`** — 通知

- 白色背景，11px 圆角，`0 2px 8px rgba(0, 0, 0, 0.15)` 阴影，12px × 16px padding。
- 从右侧滑入动画（`translateX(20px)` → `translateX(0)`）。

### Loading Overlay

**`loading-overlay`** — 加载遮罩

- `rgba(15, 23, 42, 0.28)` 半透明背景。
- 白色面板 16px 圆角，居中显示。

### Tree Controls

**`tree-table-toggle`** — 树形切换按钮

- 透明背景，6px 圆角，20px × 20px。
- Hover：`#dff3ea` 背景 + `#22a06b` 图标 + 1px 边框。

---

## Responsive Behavior

### Breakpoints

| Name    | Width      | Key Changes                    |
| ------- | ---------- | ------------------------------ |
| Desktop | ≥ 1200px   | 标准双栏布局，280px 侧边栏     |
| Tablet  | 960–1199px | 侧边栏导航项文字截断           |
| Mobile  | ≤ 960px    | 侧边栏折叠为顶部横排，内容全宽 |

### Collapsing Strategy

- **侧边栏:** 280px 固定宽度 → 960px 以下折叠为顶部横排导航。
- **模态框表单:** 1200px 以下双列变单列。
- **监控指标网格:** 大屏 4 列 → 中屏 2 列 → 小屏 1 列。
- **字典分割布局:** 大屏双列 → 小屏单列。

---

## Do's and Don'ts

### Do

- 使用 `#22a06b`（`--system-primary`）作为唯一的交互强调色。
- 品牌区的等高线保持静态，纹理集中在右侧，便于阅读左侧文字。
- 页面卡片使用 22px 大圆角 + 柔和阴影。
- 按钮使用 8px 圆角，pill 形状仅用于标签和搜索框。
- 顶栏贴合内容区的顶部和两侧，正文独立滚动。
- 表格行 hover 使用浅绿色 `#dff3ea` 高亮。
- 使用 Bootstrap 的 grid/utility 类做布局，自定义 CSS 覆盖组件样式。

### Don't

- 不要引入第二个品牌强调色（如 Bootstrap 默认蓝色 `#3b82f6`、`#2563eb`）。
- 不要使用紫色/蓝色渐变作为默认背景。
- 不要使用过大的圆角（如 24px+）在非卡片元素上。
- 不要使用纯黑 `#000000` 作为文字色。
- 不要使用强烈的阴影（如 `0 8px 30px rgba(15, 23, 42, 0.16)`）。
- 浅色主题下，深绿底色仅用于侧栏品牌卡，菜单区域保持明亮。
- 不要在新代码中使用 `.app-shell` 布局（已被 `.system-layout` 替代）。
- 不要直接写 `transition: all`，明确列出需要过渡的属性。

---

## Known Gaps

- 移动端侧边栏折叠后的抽屉式导航未详细设计。
- 表单验证错误状态的视觉规范未完整定义。
- 空状态（empty state）的插画和文案规范未定义。
- 拖拽排序、虚拟滚动等高级交互未覆盖。
- 按钮的 pressed/hover 态仍部分依赖 Bootstrap 默认值，尚未完全自定义覆盖。
- 输入框的 `:focus-visible` 聚焦环尚未统一为绿色光晕样式。
- 页面组件中的 `<h1>`-`<h6>` 尚未映射到 DESIGN.md 定义的排版 token。
