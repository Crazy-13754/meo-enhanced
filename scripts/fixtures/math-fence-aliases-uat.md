# 公式围栏一致性检查

下面五种写法使用同一个块状公式组件。Live 中点击公式或用方向键进入，源码显示在上方，预览显示在下方；退出后恢复阅读样式。复制与全选按钮位于源码右上角。

## 原生块状公式

$$
\frac{a+b}{c+d}=\sqrt{x^2+y^2}
$$

## math

```math
\frac{a+b}{c+d}=\sqrt{x^2+y^2}
```

## latex

```latex
\frac{a+b}{c+d}=\sqrt{x^2+y^2}
```

## tex

```tex
\frac{a+b}{c+d}=\sqrt{x^2+y^2}
```

## katex

```katex
\frac{a+b}{c+d}=\sqrt{x^2+y^2}
```

## 引用中的公式

> 前置正文。
>
> ```math
> \begin{aligned}
> x+y &= 3 \\
> x-y &= 1
> \end{aligned}
> ```
>
> 后置正文。检查 Enter、Tab、Shift+Tab 和多行粘贴保留引用前缀。

## 列表中的公式

- 前置正文。

  ~~~~tex
  \begin{pmatrix}1&2\\3&4\end{pmatrix}
  ~~~~

  后置正文。检查光标可以进入与离开源码，撤销能恢复原围栏。

## 空内容和错误恢复

```math

```

```latex
\frac{
```

普通代码块继续作为代码显示：

```javascript
const text = '$$x^2$$';
```
