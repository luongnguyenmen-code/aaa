# Cấu hình xem Pteranodon_Mod1_P.pak

Đã kiểm tra trực tiếp bằng FModel ngày 20/10/2026.

- Archive Directory: C:\Users\S\Downloads\Mod
- UE Versions: GAME_UE5_6
- Local Mapping File: Enabled
- Mapping File Path: C:\ST25 VIETNAM\aaa\Engine-Mappings-test.usmap
- Preview Textures: ON

Mapping tham chiếu lấy từ https://github.com/TheNaeem/Unreal-Mappings-Archive/blob/main/Bodycam/Mappings.usmap . Đã xác minh giải mã được hai Texture2D trong gói này; không coi đây là mapping đầy đủ cho mọi asset The Isle.

## Các asset trong gói (10 file vật lý)

- Materials/M_Mod.uasset + M_Mod.uexp: material, mở được dữ liệu.
- Materials/MI_Mod1.uasset + MI_Mod1.uexp: material instance, đọc được Parent=M_Mod.
- Textures/T_Pteranodon_Mod1_D.uasset + .uexp + .ubulk: ảnh màu 2048x2048, PF_DXT5, đã hiển thị.
- Textures/T_Pteranodon_N.uasset + .uexp + .ubulk: normal map 2048x2048, PF_BC5, đã hiển thị.

Gói không có skeletal mesh/static mesh. Muốn xem nguyên con 3D cần mesh và các dependency tương ứng từ game hoặc gói nguồn.

## Mở lại

1. Trong Archives, nhấp đúp Pteranodon_Mod1_P.pak.
2. Đi tới TheIsle/Content/TheIsle/Characters/Dinosaurs/Pteranodon/Textures.
3. Nhấp đúp T_Pteranodon_Mod1_D để xem ảnh màu; T_Pteranodon_N là ảnh normal màu tím.
4. Material sẽ hiển thị dữ liệu thuộc tính, không phải ảnh texture.

Lỗi ban đầu: GAME_UE4_LATEST không đọc đúng header UE5. Mapping The Isle/Evrima trong kho công khai thử đầu tiên thiếu Texture2D (log: Missing prop mappings for type Texture2D). Mapping tham chiếu lớp engine ở trên đã giải quyết việc hiển thị hai texture.
