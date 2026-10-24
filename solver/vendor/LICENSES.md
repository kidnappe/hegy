# 第三方组件许可

本项目 `solver/vendor/` 与 `solver/vendor3d/` 下的第三方代码及其许可如下。
为避免离线分发或单文件导出时丢失署名，本文件内嵌了完整许可全文，而不是只放链接。

| 组件 | 版本 | 许可 | 文件 |
|---|---|---|---|
| JSXGraph | 1.12.2 | LGPL-3.0 **或** MIT（本项目按 MIT 使用） | `vendor/jsxgraph.js`、`vendor/jsxgraph.css` |
| KaTeX | 0.19.0 | MIT | `vendor/katex/*` |
| three.js | r128 | MIT | `vendor3d/three.min.js` |
| OrbitControls | r128 | MIT | `vendor3d/OrbitControls.js` |
| Lucide Icons | 1.59.0 | ISC | `vendor/icons.js` |

## 说明

- **JSXGraph** 采用双许可（LGPL-3.0 / MIT）。本项目选择 **MIT** 分支使用，因此分发时需保留其版权声明。`vendor/jsxgraph.js` 文件头的版权块已完整保留，不得删除或改写。
- `vendor/jsxgraph.js` 为 **官方 npm 包的 minified 分发版**（`jsxgraph@1.12.2/distrib/jsxgraphcore.min.js`），未做任何修改。如需升级，请从官方渠道获取，不要在本地改写后分发。
- `vendor/jsxgraph.js` 内还包含 Bjoern Hoehrmann 的 UTF-8 Decoder（MIT），其版权与许可声明保留在该文件头部。
- `vendor/jsxgraph.js` 与 `vendor3d/three.min.js` 的源文件保留了完整版权头；KaTeX 压缩版、OrbitControls、Lucide 的源文件未携带完整版权块，其版权与许可以本文件为准。KaTeX 的字体文件（`vendor/katex/fonts/*.woff2`）随 KaTeX 包以同一 MIT 许可分发。
- 以上许可均为宽松许可，与项目的 AGPL-3.0-only 兼容。

## 自研部分

`solver/solver.js`、`solver/ui.js`、`solver/serve.js`、`solver/mock.js`、
`solver/geometry.js`、`solver/shim.js`、`solver/vendor3d/render3d.js`、`solver/ui.css`
均为本项目自行编写，不含上述第三方代码，采用 **AGPL-3.0-only** 授权，完整条款见根目录 [`LICENSE`](../../LICENSE)。

---

## MIT License

适用组件：JSXGraph 1.12.2、KaTeX 0.19.0、three.js r128、OrbitControls r128。

### JSXGraph

```text
Copyright 2008-2025
    Matthias Ehmann,
    Michael Gerhaeuser,
    Carsten Miller,
    Bianca Valentin,
    Andreas Walter,
    Alfred Wassermann,
    Peter Wilfahrt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Bjoern Hoehrmann UTF-8 Decoder（内嵌于 `vendor/jsxgraph.js`）

```text
Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### KaTeX

```text
Copyright (c) 2013-2020 Khan Academy and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### three.js / OrbitControls

```text
Copyright 2010-2021 Three.js Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## ISC License

适用组件：Lucide Icons 1.59.0。

```text
Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022
as part of Feather (MIT). All other copyright (c) for Lucide are held by
Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
