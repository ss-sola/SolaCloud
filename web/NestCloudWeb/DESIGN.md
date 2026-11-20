---
version: alpha
name: NestCloud System Design
description: |
  A unified admin interface built on Bootstrap 5.2.3 with a green-accented design system.
  Custom CSS overrides layer on top of Bootstrap defaults to establish the brand palette,
  spacing, and component styling. The layout uses a two-zone sidebar (green-gradient brand
  card + light navigation), frosted-glass topbar, parchment canvas background, and rounded
  utility cards. The single brand accent is a fresh green (#22a06b) used for primary actions,
  active nav items, and status indicators.
---

## Overview

NestCloud Web 是一个统一的后台管理前端，基于 **Bootstrap 5.2.3**，在其之上叠加了 **绿色强调色系统**。核心视觉区域包括：**品牌侧边栏**（绿色渐变品牌卡 + 浅色导航）、**磨砂玻璃顶栏**、**浅色内容画布**（Parchment 背景）和 **圆角内容卡片**。

整体风格是 **清爽的现代管理界面**：绿色渐变侧边栏建立品牌识别，浅色内容区承载数据表格和表单，组件使用柔和的圆角和阴影营造层次感。

**Key Characteristics:**

- **单一绿色强调色** (`#22a06b`) 贯穿所有交互元素：主按钮、活跃导航项、状态徽章、焦点环
- **Bootstrap 5.2.3 为基础**，通过自定义 CSS 覆盖默认样式（按钮、输入框、模态框、分页器等）
- **绿色渐变品牌侧边栏** (`linear-gradient(160deg, #1f9d63, #2f855a)`) 带有装饰性椭圆伪元素
- **Parchment 背景** (`#edf2f7`) 作为全局底色，内容卡片为纯白 `#ffffff`
- **圆角语法**：sm=8px（按钮/输入框）、md=11px（导航项）、lg=16px（顶栏）、xxxl=22px（页面卡片）、pill=9999px（标签/搜索框）
- **字体**：Inter + PingFang SC + Microsoft YaHei，body 17px，weight 400/600/700/800（无 500）
- **顶栏磨砂玻璃**：`backdrop-filter: blur(8px)`，半透明白色背景
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

### Brand & Accent

- **Brand Green** (`#22a06b`): 唯一的品牌强调色。所有主按钮、活跃导航项、链接、焦点环、成功状态都用此色。
- **Brand Green Pressed** (`#1d8a5e`): 按下态和链接色。
- **Brand Green Soft** (`#dff3ea`): 极浅的绿色，用于活跃导航背景、hover 态、badge 底色。

### Surface

- **Canvas** (`#ffffff`): 纯白，内容卡片、表格、模态框的底色。
- **Parchment** (`#edf2f7`): 全局页面背景色，浅灰蓝调。
- **Surface Soft** (`#f8fafc`): 极浅的冷色调，用于侧边栏导航背景、汇总面板、指标卡片。
- **Sidebar Dark Gradient** (`#1f9d63` → `#2f855a`): `linear-gradient(160deg, #1f9d63, #2f855a)`，品牌侧边栏品牌区的渐变。

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

| Level         | Treatment                            | Use                              |
| ------------- | ------------------------------------ | -------------------------------- |
| Flat          | 无边框、无阴影                       | 全局背景、侧边栏品牌区           |
| Soft shadow   | `0 20px 48px rgba(15, 23, 42, 0.08)` | 页面卡片、登录面板               |
| Hairline      | 1px `rgba(15, 23, 42, 0.08)`         | 输入框边框、卡片边框、表格分隔线 |
| Backdrop blur | `backdrop-filter: blur(8px)`         | 顶栏磨砂玻璃效果                 |
| Brand shadow  | 品牌区白色椭圆伪元素装饰             | 侧边栏品牌区视觉层次             |

---

## Shapes

### Border Radius Scale

| Token | Value  | Use                    |
| ----- | ------ | ---------------------- |
| none  | 0px    | 品牌区底部装饰         |
| xs    | 5px    | 树形控件切换按钮       |
| sm    | 8px    | 按钮、输入框、分页按钮 |
| md    | 11px   | 导航项、Toast          |
| lg    | 16px   | 顶栏、加载面板         |
| xl    | 18px   | 指标卡片               |
| xxl   | 20px   | 登录面板               |
| xxxl  | 22px   | 页面内容卡片           |
| pill  | 9999px | 标签、搜索框、信息芯片 |

---

## Components

### Navigation

**`sidebar-brand`** — 品牌区

- 渐变背景 `linear-gradient(160deg, #1f9d63, #2f855a)`，白色文字。
- 底部圆角 44px，有两个白色半透明椭圆伪元素作为装饰。
- 标题 32px weight 800，副标题 16px。

**`sidebar-link`** — 导航项

- 默认：透明背景，`#1f2937` 文字，11px 圆角，11px × 14px padding。
- 活跃：`#dff3ea` 背景，`#22a06b` 文字。
- hover：极浅绿色背景。

**`sidebar-group-toggle`** — 分组折叠按钮

- 14px 圆角，`#6b7280` 文字，10px × 14px padding。
- hover：浅绿色背景 + 绿色文字。

### Topbar

**`topbar`** — 页面顶栏

- 半透明白色背景 `rgba(255, 255, 255, 0.86)`，磨砂玻璃 `blur(8px)`。
- 16px 圆角，`0 12px 28px rgba(15, 23, 42, 0.06)` 阴影。
- 14px × 18px padding，标题 20px weight 700。

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
- 侧边栏品牌区使用绿色渐变 + 白色椭圆装饰伪元素。
- 页面卡片使用 22px 大圆角 + 柔和阴影。
- 按钮使用 8px 圆角，pill 形状仅用于标签和搜索框。
- 顶栏使用磨砂玻璃效果。
- 表格行 hover 使用浅绿色 `#dff3ea` 高亮。
- 使用 Bootstrap 的 grid/utility 类做布局，自定义 CSS 覆盖组件样式。

### Don't

- 不要引入第二个品牌强调色（如 Bootstrap 默认蓝色 `#3b82f6`、`#2563eb`）。
- 不要使用紫色/蓝色渐变作为默认背景。
- 不要使用过大的圆角（如 24px+）在非卡片元素上。
- 不要使用纯黑 `#000000` 作为文字色。
- 不要使用强烈的阴影（如 `0 8px 30px rgba(15, 23, 42, 0.16)`）。
- 不要使用深色侧边栏（`#0f172a`），侧边栏应为浅色 `#f8fafc`。
- 不要在新代码中使用 `.app-shell` 布局（已被 `.system-layout` 替代）。
- 不要直接写 `transition: all`，明确列出需要过渡的属性。

---

## Known Gaps

- 移动端侧边栏折叠后的抽屉式导航未详细设计。
- 表单验证错误状态的视觉规范未完整定义。
- 暗黑模式不在当前设计系统范围内。
- 空状态（empty state）的插画和文案规范未定义。
- 拖拽排序、虚拟滚动等高级交互未覆盖。
- 按钮的 pressed/hover 态仍部分依赖 Bootstrap 默认值，尚未完全自定义覆盖。
- 输入框的 `:focus-visible` 聚焦环尚未统一为绿色光晕样式。
- 页面组件中的 `<h1>`-`<h6>` 尚未映射到 DESIGN.md 定义的排版 token。
