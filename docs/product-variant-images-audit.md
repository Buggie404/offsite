# Kiểm tra ảnh sản phẩm và ảnh theo variant

Thời điểm đọc database: lúc 12:50 Chủ Nhật, 8 tháng 11, 2026 (giờ Việt Nam).

Nguồn: collection `Products`, đọc trực tiếp database; báo cáo không chỉnh sửa dữ liệu.

## Tổng hợp

| Hạng mục | Số lượng |
| --- | ---: |
| Tổng sản phẩm | 92 |
| Sản phẩm có ảnh riêng ở ít nhất một variant | 22 |
| Sản phẩm không có ảnh riêng ở bất kỳ variant nào | 70 |
| Sản phẩm có variant có ảnh và variant chưa có ảnh | 0 |
| Tổng variant/SKU | 124 |
| Variant có ảnh riêng | 51 |
| Variant thiếu mã SKU | 0 |

## Cách đọc

- **Ảnh chung** nằm trong `product.images`; **ảnh variant** nằm trong `product.variants[].images`.
- “Có ảnh riêng” nghĩa là có URL được gắn trong dữ liệu variant. URL đó vẫn có thể trùng với ảnh chung hoặc ảnh variant khác; không có nghĩa là ảnh độc quyền của một SKU.
- Label “(trống)” là dữ liệu thật đang rỗng. `variant_type: none` nghĩa là không có lựa chọn size/màu; sản phẩm vẫn có SKU bán hàng.
- Gallery Images trong Edit Product hiện gộp ảnh chung và ảnh variant, bỏ URL trùng. Số ảnh gallery dưới đây tính theo URL duy nhất.
- Link ảnh là URL đang lưu trong database; báo cáo chưa kiểm tra khả năng tải từng URL.

## 1. Sản phẩm có ảnh theo variant

### 10001 — House Matcha

Danh mục: `matcha` · Variant type: `size` · Gallery: **3 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859422/xrtkylbto9lajnwaiags.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT002 | 100 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859421/j7wk7nxtmvzpbtbb06wi.png>) |
| MAT003 | 250 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859421/vt32rbv2gjwqe84v3vzb.png>) |

### 10004 — Miyuki

Danh mục: `matcha` · Variant type: `package` · Gallery: **4 ảnh khác URL**.

Ảnh chung (2): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859414/ywxmqcodjuzvqs2ayxlt.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859414/qcv6adfpcmuxppcluqqc.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT006 | Aluminum can - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859417/gleeezeumvmoaqizi02p.png>) |
| MAT007 | Plain bag - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859416/f2vo07dpmco6dobxjkan.png>) |

### 10005 — Itsuki

Danh mục: `matcha` · Variant type: `package` · Gallery: **4 ảnh khác URL**.

Ảnh chung (2): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859411/pyb9iessdmkrpvl8tyfq.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859410/ubxc3hz1ems92rb1j15r.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT008 | Washi wrapped - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859411/ckptmz1sxkoth1uuxpze.png>) |
| MAT009 | Plain bag - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859413/ttaxzt2wpxu2wiqit4d0.png>) |

### 10007 — Koji

Danh mục: `matcha` · Variant type: `package` · Gallery: **4 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859402/widfmasnb1rww4rptf7k.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT011 | Plain bag - 50 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859405/eagyzjxs1vf5hgfjfyug.png>) |
| MAT012 | White washi wrapped - 50 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859404/jskln5kjrv6fkibocyze.png>) |
| MAT013 | Oita washi wrapped - 50 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859402/sk1keadvfgiq2j0zvs8j.png>) |

### 10008 — Shino

Danh mục: `matcha` · Variant type: `package` · Gallery: **4 ảnh khác URL**.

Ảnh chung (2): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859399/kpk32fvczazetewibjbl.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859398/sals3g4ezeilocybueoo.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT014 | Washi wrapped - 50 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859400/dhhaaypzbisur2yfi3uz.png>) |
| MAT015 | Plain bag - 50 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859399/ozdl3fabnamnvqfg8jin.png>) |

### 10014 — Ichiko

Danh mục: `matcha` · Variant type: `package` · Gallery: **5 ảnh khác URL**.

Ảnh chung (3): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859386/bhj4fbjcgvlyzgn1mprc.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859385/gy6z25ebwyfgig15o5iy.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859384/szs0blkzkmcmod5otocr.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT021 | Plain bag - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859387/r4hlyuewvdq9emtthkt8.png>) |
| MAT022 | Washi Wrapped - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781861513/x4omz9tupkxo5dhklwh8.png>) |

### 10016 — Ayako

Danh mục: `matcha` · Variant type: `package` · Gallery: **4 ảnh khác URL**.

Ảnh chung (2): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859379/u0ucwnbhiqdjxcqmgx7b.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859380/yjeho1x8etqlaklu3ei8.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT024 | Plain bag - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781861893/th6btzvzomh04mljjarm.png>) |
| MAT025 | Washi Wrapped - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859380/bluixgrocp7xkypjgqek.png>) |

### 10017 — Ayame

Danh mục: `matcha` · Variant type: `package` · Gallery: **4 ảnh khác URL**.

Ảnh chung (2): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859377/ncnkpngivnmkyib5u63e.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859379/arhnnoqe6sj73krohfym.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MAT027 | Plain bag - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781862035/ouivczgts97aavsjaxan.png>) |
| MAT028 | Washi Wrapped - 40 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859377/oreoelkj2dkno0i8zgvn.png>) |

### 11000 — Agaro

Danh mục: `coffee` · Variant type: `size` · Gallery: **3 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859463/o1qtin1apc8e2cmbedmy.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF001 | 250 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859463/o1qtin1apc8e2cmbedmy.png>) |
| COF002 | 2 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859463/lsufeilgad0wx7qr1hmk.png>) |
| COF003 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859464/x2fdjpc63gy5dijft7an.png>) |

### 11001 — Cusco

Danh mục: `coffee` · Variant type: `size` · Gallery: **3 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859460/ln7fms9lnkzbeaq83ikp.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF004 | 250 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859460/ln7fms9lnkzbeaq83ikp.png>) |
| COF005 | 2 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859460/p4ogyoegi4hcqoeaww5z.png>) |
| COF006 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859462/muo2zkecegtty5q7rohv.png>) |

### 11002 — Los Sueños Decaf

Danh mục: `coffee` · Variant type: `size` · Gallery: **3 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859459/bwdnhx7xkqved3j50vxe.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF007 | 250 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859459/bwdnhx7xkqved3j50vxe.png>) |
| COF008 | 2 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859458/ky2xqdvqmjfmm60bjn0a.png>) |
| COF009 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859457/rbnnbfvkbkvnwyyfatix.png>) |

### 11003 — Heza

Danh mục: `coffee` · Variant type: `size` · Gallery: **3 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859457/fj7owz0lonjupz9hpxca.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF010 | 250 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859457/fj7owz0lonjupz9hpxca.png>) |
| COF011 | 2 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859454/wtqn5i5raj2kszwa6tcf.png>) |
| COF012 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859455/oafb7zcsbht9ysjp66kg.png>) |

### 11008 — Huye Mountain, Rwanda

Danh mục: `coffee` · Variant type: `size` · Gallery: **3 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859446/dculxsjnyt0zsv2ku3k2.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF019 | 11 oz | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859448/r5vgatmnqrvvtkfnsiwq.png>) |
| COF020 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859446/auhmyf6obdbdepetiim8.png>) |

### 11009 — Bies Penantan, Indonesia

Danh mục: `coffee` · Variant type: `size` · Gallery: **1 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859441/utdyzu50afkredki63lr.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF021 | 11 oz | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859441/utdyzu50afkredki63lr.png>) |
| COF022 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859441/utdyzu50afkredki63lr.png>) |

### 11010 — El Injerto Bourbon, Guatemala

Danh mục: `coffee` · Variant type: `size` · Gallery: **2 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859444/fxpmtz66tlzeykz1ijiw.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF023 | 11 oz | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859444/fxpmtz66tlzeykz1ijiw.png>) |
| COF024 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859443/o3ufw6sgfpg0rrmhvuyx.png>) |

### 11011 — Mordecofe, Ethiopia

Danh mục: `coffee` · Variant type: `size` · Gallery: **2 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859443/j6ilp5tvuj3ihb2wjcmn.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF025 | 11 oz | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859443/j6ilp5tvuj3ihb2wjcmn.png>) |
| COF026 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859442/gucvkm8uazzj8leldsbv.png>) |

### 11012 — Montañas de Fuego Decaf, Costa Rica

Danh mục: `coffee` · Variant type: `size` · Gallery: **2 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859438/mzognmhckgm70v7sg0yt.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF027 | 11 oz | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859438/mzognmhckgm70v7sg0yt.png>) |
| COF028 | 5 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859439/pgicixzuwke63zz8r79d.png>) |

### 11015 — Wilmer Julca

Danh mục: `coffee` · Variant type: `size` · Gallery: **2 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859435/wu9kvlhjbhrjqf2gioco.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF031 | 250 g | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859435/wu9kvlhjbhrjqf2gioco.png>) |
| COF032 | 2 lb | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859435/yv8tocymrgygyvuqs1pv.png>) |

### 11017 — Pedro Nel Trujillo

Danh mục: `coffee` · Variant type: `none` · Gallery: **3 ảnh khác URL**.

Ảnh chung (3): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859430/lln72gpvolqzac6ieplv.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859431/wubo1rn9e6rbdoc2fzcc.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859429/hrvfztveepbhqwda5b0z.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| COF034 | 6 oz | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859430/lln72gpvolqzac6ieplv.png>) |
| COF035 | 12 oz | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859430/lln72gpvolqzac6ieplv.png>) |

### 12014 — Origami Matcha Bowl

Danh mục: `tools` · Variant type: `color` · Gallery: **4 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863752/afpdjcezvvwpsypldfjn.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| TOM009 | green | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863761/mufswypjijh47e4usdai.png>) |
| TOM010 | red | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863755/n5zcein5jkkuk3dczfty.png>) |
| TOM011 | black | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863758/ghk9n1vunewaopw96ziq.png>) |

### 13002 — Ceramic Gaiwan

Danh mục: `drinkware` · Variant type: `color` · Gallery: **4 ảnh khác URL**.

Ảnh chung (2): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886989/ayitrgtnzuqst8zepo2b.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886987/y4curv8eslmv81xvqku1.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| MUG002 | green | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886991/rf7z3exllu9cspyimix5.png>) |
| MUG003 | pink | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886990/vuhqtwxlfedxexnpy0qe.png>) |

### 13008 — Teapot with Basket Infuser

Danh mục: `drinkware` · Variant type: `color` · Gallery: **4 ảnh khác URL**.

Ảnh chung (1): [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886982/hq4jtlj4oppswgvljo2m.png>)

| SKU | Label | Số ảnh variant | Link ảnh variant |
| --- | --- | ---: | --- |
| TEP003 | white | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886982/gdyzrsw9hqr5wdmmrkb1.png>) |
| TEP004 | indigo | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886982/o4fh0duqgsb9ociyvnkx.png>) |
| TEP005 | olive | 1 | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886982/bhno5jq48mq8giovbb5e.png>) |

## 2. Sản phẩm chưa có ảnh riêng cho variant

Các SKU dưới đây chưa được gắn ảnh riêng. Cột ảnh chung cho biết sản phẩm vẫn có ảnh ở cấp sản phẩm hay không.

| ID | Sản phẩm | Variant type | SKU — label | Ảnh chung |
| --- | --- | --- | --- | --- |
| 10000 | Tsuyu Matcha | none | MAT001 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859423/rwic46xlx8kw1usbs9ut.png>) |
| 10002 | Silver Needles | none | MAT004 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859419/vgssa6vcee0ih68lqgl5.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859419/iuu0onl47y28wish6asr.png>) |
| 10003 | Ogura Matcha | none | MAT005 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859418/uustzsymdu8bkcuyufv8.png>) |
| 10006 | Tsuyoshi | none | MAT010 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859408/wabhikeagcrxhisvuegm.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859408/jq4hou4qdfrx2e1un4kn.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859408/za2xkbdqofo7orot5giu.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859406/wnyswaivrsqjd0a3muvv.png>) |
| 10009 | Orchid Dancong | none | MAT016 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859397/tmbxtziro0oo4obudsrw.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859396/yvm9nohlmdx2z1qgr78p.png>) |
| 10010 | Meizhan Yancha | none | MAT017 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859394/fhqkehlsuxu3wbqwdrrp.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859394/wdyutf3rqwducc3y4dln.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859395/eaokkpataad9d2jbifxq.png>) |
| 10011 | Okumidori | none | MAT018 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859393/yybmi50u9qdymifz6d5f.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859391/nj3zdsyzcfcaatcs63bz.png>) |
| 10012 | Saemidori | none | MAT019 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859391/qbbvlsyb8qtchin5bsfc.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859389/uzf4ezi6lblutngf6ku3.png>) |
| 10013 | Reishi Mushroom | none | MAT020 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859388/w7wc08rpcwulrrnz3jek.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859389/jqn6g2nfnxpbzbiiff52.png>) |
| 10015 | Masashi | none | MAT023 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859383/c72sbyt8pe4clarglde2.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859383/iis5mizjeuejxtnwjjlf.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859381/pnidlkzknu8j2gyjwwjv.png>) |
| 10018 | Craft Matcha | none | MAT029 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781862369/r6daerjx7w8865qqyz6u.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781862439/u0do70dmsdir1dpt8rs2.png>) |
| 10019 | Yumiko | none | MAT030 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859373/tb4kqzh9otshuzyb8vcc.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859374/ddhpbfimsb6o8grt3kua.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859373/jx8e84uwq5mhpindsdav.png>) |
| 10020 | Yuki | yuki | MAT031 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859372/anl62pzgprrmjple0jea.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859360/wbfuntqphur79rsb0oxk.png>) |
| 10021 | Matcha Sonogi | none | MAT032 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859359/r1pzas2owniuj5uliz8k.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859357/dv4vngamp4zgcd3pfg6e.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859358/kwubwu5zw3vfy18wmplv.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859356/tkn27yxjueuai9wmsxlt.png>) |
| 10022 | Matcha Wazuka | none | MAT033 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859352/bre5qvg7fogxt7n7ecnd.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859354/yrvm6m53y3x3tcxzh3w6.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859355/ngxwoliifklu32z82grd.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859354/qeopzxlk7d9a02aconv2.png>) |
| 10023 | Matcha Kame | none | MAT034 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859352/jtvsblzwy0ghsqbtlity.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859351/sedezrdogcymeroairpe.png>) |
| 10024 | Champagne Long Kou oolong tea | none | MAT035 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859350/cq3qivz2vfirbhgtncgd.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859349/ci77knulpwcdgxvxewp5.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859349/fieifuctojivsgqg0atk.png>) |
| 10025 | Craft Hojicha | none | MAT036 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781862675/r1ettmtgenwf40m3a7bs.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781862659/gbi8shsg2nyvrgeynhrq.png>) |
| 11004 | Mountain Harvest | none | COF013 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859453/fimgupxqgyglscnogj1k.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859453/jhetzvsn4gle0cdxtbl5.png>) |
| 11005 | Nueva Llusta | none | COF014 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859452/ygyqegkfubf9vvfosw0g.png>) |
| 11006 | Mpemba | none | COF015 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859451/hxooto5yp8bnlvudxh4u.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859450/gmm9fbeoxvhqoex0illz.png>) |
| 11007 | La Golondrina | size | COF016 — 12 oz<br>COF017 — 24 oz<br>COF018 — 5 lb | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859449/zbgmyndgnc0lwql6fwlw.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859448/lwy8gl9uj5cccfhwg51u.png>) |
| 11013 | Rio de Abejas | none | COF029 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859437/cfth8lzymi4sqvwy0qor.png>) |
| 11014 | Sipi | none | COF030 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859437/z0th9dggzbgatuafm13o.png>) |
| 11016 | Night Light Decaf | none | COF033 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859433/oqnvotjmrioc4dvsmj1e.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859434/gcf3lq5fwjc1yybwffxn.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859432/lhsy4wb9dlkf1mya3a8w.png>) |
| 11018 | Beneficio San Vicente | size | COF035 — 6 oz | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859429/ljnjh256zywzbonplh0n.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859427/qacq2re5hx04cxkftlga.png>) |
| 11019 | Tokyo Kissa | none | COF036 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859427/s7kj8qvaumdkjxqkpqcz.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781859426/grqra3mtginubnnum1o4.png>) |
| 12000 | Handmade Matcha Bowl | size | TOM001 — 13 oz<br>TOM002 — 20 oz | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864612/wnleohpfcrqjlqywtju9.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864610/fov5mbab321lbt12zci7.png>) |
| 12001 | April Paper Filter | none | TOC001 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864607/vydzd02gusqoje3oph21.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864603/y5sy6hkfxx5ka3smokka.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864600/qqxurjo8mrqjtmngkvnd.png>) |
| 12003 | Hekikai Matcha Bowl | none | TOM003 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864631/n5utza9m96zl4ovybbvl.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864628/abb3tdnpuiwmgq1qvasm.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864625/mj3rwt7mxsztkcjrfmyo.png>) |
| 12004 | Kubo Sabun Matcha Scoop | none | TOM004 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864618/kzofmbpvqpyjsjz3nrjq.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864622/prxoextv2ffsoy20scc4.png>) |
| 12005 | Matcha Whisk Holder | none | TOM006 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864615/rhxke56cwsatswycspy1.png>) |
| 12006 | Chasen Matcha Whisk | none | TOM007 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781864597/jobctahiuva1emhwdy8y.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863850/j0df4d5szhfa84dve8zo.png>) |
| 12007 | Chemex Brewer with Wood Collar | none | TOC002 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863833/kav6vxbkq5v6qirj9kjk.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863830/godxaot0efpjzmlnsopr.jpg>) |
| 12008 | Bodum French Press | none | TOC003 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863824/jlpstkxf9pl2oxkdqukr.png>) |
| 12009 | Baratza Encore Burr Grinder | none | TOC004 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863827/dlrfpd84tu7mzplbo8ul.png>) |
| 12010 | Hario Buono Kettle Electric | none | TOC005 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863836/s1wd5mywcn9iw15jspob.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863840/dbbhxjqsoifpmdbfhk04.jpg>) |
| 12011 | Kalita Wave Stainless | none | TOC006 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863820/ngqdjsciwzosk2qih2b4.png>) |
| 12012 | Chemex Glass Coffeemaker Cover | none | TOC007 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863818/b5f12rqlw3l98g4mo6yn.png>) |
| 12013 | AeroPress Filter | none | TOC008 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863764/qcasd9hjip2gwreh9yge.png>) |
| 12015 | Wood-Handled Pouring Kettle | none | TOM012 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863749/etuuy920e9vlmk0dlexd.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863746/h2dhz0irgwmwfxers8mf.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863743/uikbk4k2j6b8ybfslhmt.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863739/yhrzjvingyxocmurcmg6.png>) |
| 12016 | Blue Bottle Coffee Dripper | none | TOM013 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863736/qe0lj51e2u0atoqrskyx.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863733/hxkuhxlwu01iwugrrj3k.png>) |
| 12017 | Baratza Encore ESP Grinder | none | TOC009 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863730/brwcpzifap6ooxuqnwcg.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863727/znx4co9ijwl0flgxqdlz.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863724/qznwhyjuwyudtgc4cc01.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781863721/xyv1rctdq3jxjn1n2phs.png>) |
| 13000 | Halftones Blue Milk-glass Mug | none | MUG001 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886995/spcky5rk996vsyt0gtry.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886994/q17hwgonwpgjkkrhzw7n.png>) |
| 13001 | Passenger Kinto Travel Tumbler | none | BOT001 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886992/e8edzxslhctqlghwouco.png>) |
| 13003 | Kinto UNITEA One Touch Glass Teapot | none | TEP001 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886986/vsdmvevf2h3ujdrxwsfu.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886984/o3tzimjpsxlu1xbng7q6.png>) |
| 13004 | Travel Tumbler | none | BOT002 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887006/v3dqqfahe6zia8ye5szq.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887007/viivpf0rvepgfjsethgq.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887010/gkhozf6s7hmonb3btfiq.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887009/byf8gzamrxsnufpevvon.png>) |
| 13005 | Essence Tea Cup | none | MUG004 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887005/jhayvfnlqn5baqrg0pu5.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887005/vksgk8c1gr9cn6ik92wu.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887005/fciaolavtdipz5sjh17u.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781887005/kagb6c3zfbekvs78oogu.png>) |
| 13006 | Arita Tea Pot | none | TEP002 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886999/s9ta9w4c9kideckp8d1d.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886999/jrf3p0nsgrvrxi6gvjxw.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886999/otm7cvhvsrfxxrmenncb.png>) |
| 13007 | Peace Dove Mug | none | MUG005 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886986/rfvwrkauf5yydjmllxxb.png>) |
| 13009 | Bird Song Sipper | none | BOT003 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886977/n9p1af9acqwxqeggohp9.png>) |
| 13010 | Highland Grog Handthrown Mug | none | MUG006 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886965/d9wxbjsiu1fqwx7jblog.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886965/l10yaiy5jrup8gon8lrc.png>) |
| 13011 | Tokoname Inka Teapot | none | TEP007 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886965/nt1aao4hxg7h13xg56rq.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886965/jdbfz25nqz5xpgtcnqvs.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886965/fbzbbo7ckqafpodga5mg.png>) |
| 13012 | MiiR Climate+ Bottle in White | none | BOT004 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886970/i3vmthdyyryalaqnajaj.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886968/qrnp5okxzkasgv85qoaa.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886970/mvx9t2wtdpijmii9raqx.png>) |
| 13013 | Fellow Carter Move Mug in White | none | MUG007 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886959/egwcg7ok4rhky3d37p4d.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886959/v0gltxlet288drp2qz37.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886959/wgrs515tdcevgmkwifl0.png>) |
| 13014 | FORLIFE Teapot with Basket Infuser | none | TEP008 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886955/polhz8mq0vwco51mrzqr.png>) |
| 13015 | HARIO tea bottle | none | BOT005 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781888665/vfohmuaprab2ddsxx4fp.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781888665/tr9k0j96f3ra8siudfvy.png>) |
| 13016 | Iroiro Sand Teapot | none | TEP008 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886973/mxu7nxveuxcjr6phdvoj.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886973/p7pqbk7vitorckija1cw.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781886973/gcpbkwtjf3vo7xyqthhp.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/yylrrju6rlkdyyadyg0y.png>) |
| 14000 | Blue Bottle Pour Over Kit | none | SET001 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889044/ebmbbcfvrw9e4wculbsg.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889044/mt8hdy5injrhyx70ts0k.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889044/u3rnaglhsfvpf66jirp9.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889044/sjkrwt4uyhow3mavkbw7.png>) · [Ảnh 5](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889044/fbail8lvpdetu390q9x8.png>) |
| 14001 | Craft Hōjicha and Matcha Set | none | SET002 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889199/lsfpbss2fwpurk9oewcs.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889199/qtn0rnweqhnuf9b4dhwn.png>) |
| 14002 | Craft Matcha and Whisk Set | none | SET003 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889217/upblhsbpx8ymq9403dwu.png>) |
| 14003 | Hasami Porcelain Set | none | SET004 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889242/cgshwqqhmaxdltyxthwf.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889242/ronhqheqyduvfcr0xbvg.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889242/lxpcrn5qo6ybbsvo9cii.png>) |
| 14004 | Craft Hōjicha Set of Three | none | SET005 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889251/yjj12x31p6izre4bl7ib.png>) |
| 14005 | Day & Night Bundle | none | SET006 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889341/njbutucf6ce8o6rj5uuj.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889341/oozfrl0mwndemvt96lmp.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889341/pblqcyqsn5gbepkqldpe.png>) |
| 14006 | Blend Trio | none | SET007 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889275/ztyqlj051i3p3t15mm2h.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889275/e6sms3jmi1jfdhvsfhnc.png>) |
| 14007 | Oribe Tokoname Teaware Set | none | SET008 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889296/jxiwskgbwhwfm0sykhjx.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889296/i17orfeayy9s306agfjk.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889296/mtnfz9wxvncd9ird4tcu.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889296/znxopegolqcclsp8sasu.png>) · [Ảnh 5](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889296/q2zg5y6ngq1psuqzqq3m.png>) |
| 14008 | Dark Roast Bundle | none | SET009 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889305/phhzosqpcn6us8qra86s.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889305/szee4ugpyenta196zemt.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889305/em9lyygebea9fzfdshxl.png>) |
| 14009 | Home Barista Bundle | none | SET010 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889074/kt7x2abtegvskw5s2abe.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/qclbyr6fjn8e5ftdyjne.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889074/iwdnedi0rin3gaeasn0y.png>) |
| 14010 | Gyokuro & China Set | none | SET011 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889191/byh8jiznpwooy9gkxfyz.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889191/izmrhf59fvj14zfw8qir.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889191/l4el6jjxlxami7rsp9id.png>) |
| 14011 | Matcha Gift Box | none | SET012 — (trống) | [Ảnh 1](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889136/pkicookxaweh3y1vw7l8.png>) · [Ảnh 2](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889136/pbfauf5thbr85q8yqcom.png>) · [Ảnh 3](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889136/asxzuhfesd0owatgfemi.png>) · [Ảnh 4](<https://res.cloudinary.com/dgsgmnnyr/image/upload/q_auto/f_auto/v1781889136/wd1wtfrkxchbxagayhsq.png>) |

## 3. Bản ghi cần kiểm tra thêm

- **10004 — Miyuki**: `variant_type = package`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
- **10005 — Itsuki**: `variant_type = package`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
- **10007 — Koji**: `variant_type = package`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
- **10008 — Shino**: `variant_type = package`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
- **10014 — Ichiko**: `variant_type = package`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
- **10016 — Ayako**: `variant_type = package`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
- **10017 — Ayame**: `variant_type = package`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
- **10020 — Yuki**: `variant_type = yuki`, nằm ngoài các giá trị form hỗ trợ (none, size, color, type). Cần kiểm tra lại cấu hình nghiệp vụ; báo cáo không tự sửa database.
