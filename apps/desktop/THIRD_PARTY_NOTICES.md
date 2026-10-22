# Desktop pet source and asset notices

## Independent dsh-pet

The separate Windows companion vendors [dsh-pet by PC2005-cloud](https://github.com/PC2005-cloud/dsh-pet), commit `6c5f04321be050525b5cbb7bb8ee5f53e89deb6f` (0.3.7). Unchanged source digests are in `vendor/dsh-pet/UPSTREAM.json`; output adaptations are documented in `PATCHES.md`.

**Media has separate conditions:** upstream animations, prompts and source videos allow open-source use and prohibit commercial use. Derived introductions, displays and distribution must credit and link to https://github.com/PC2005-cloud/dsh-pet. This media is not covered by the code's MIT license. The unverified 上首软糖体 font is excluded; the default is the system font.

Code: MIT License, Copyright (c) 2026 PC2005-cloud. The full MIT license is retained in `resources/dsh-pet/LICENSE` and `vendor/dsh-pet/LICENSE`.

## Existing atlas companion

The Windows desktop pet uses adapted source code and assets from [TokenTracker](https://github.com/xiufengsun/TokenTracker):
`src/renderer/pet.jsx`, `src/renderer/lib/pet-*`, `src/renderer/lib/bot-appearance.js`,
`src/renderer/ui/foundation/{BotAnimated,PetAtlasAnimated}.jsx`, and
`src/renderer/public/clawd`. The code is adapted to Quotern's Electron host and
local usage data contract.

MIT License

Copyright (c) 2026 xiufengsun

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

## Additional bundled atlas pets

`src/renderer/public/pets/` contains the six pet packages supplied through the
user's existing imports: Doro (`doro`), 咕嘎 (`guga`), 鸡哥ikun (`ikun`),
罗小黑 (`luoxiaohei2d`), Monthly salary cat（月薪猫） (`monthly-salary-cat`),
and 小八 (`xiaoba`). Their `pet.json` manifests and `spritesheet.webp` atlases
are retained unchanged. The imported manifests do not record authors or license
terms; the TokenTracker code and asset license above does not establish a license
for these additional character images.

## Bot companion morphing engine

`src/renderer/lib/bot/` is TokenTracker's unmodified copy of the [bloub](https://github.com/jeremy-prt/bloub)
engine by Jérémy Perret, vendored there at commit `b4bb3c1b5f93c7b87a2e8d620f667c4093d97749`.

Copyright © 2026 Jérémy Perret

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
