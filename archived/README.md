# 動體人臉影像卸妝（Cascaded CNN）

依 `ゴカクエイ研究計画書.pdf` 實作之最小骨架：級聯式 U-Net，以 L1 損失、感知損失與免光流之時間一致性損失訓練。

| 檔案 | 內容 |
|---|---|
| `model.py` | `CascadedNet`：各級 U-Net 預測殘差，逐級修正前一級輸出 |
| `data.py` | 成對資料集、訓練／驗證切分、劣化模擬（低照度、模糊、JPEG 壓縮） |
| `train.py` | 訓練；每個 epoch 存檔，中斷後以相同指令重跑即自動續訓 |
| `eval.py` | 驗證集之 PSNR／SSIM（含各種劣化輸入）與模型 fps |
| `infer.py` | 影片推論：逐幀偵測人臉、裁切、卸妝、將殘差羽化貼回原幀 |
| `test_smoke.py` | 以假資料跑完整流程之自我檢查 |

## 資料格式

```
data/pairs/makeup/0001.png   帶妝（模型輸入）
data/pairs/bare/0001.png     素顏（目標），與上圖同檔名且像素對齊
```

檔名排序後之最後 10% 作為驗證集。

## 本機檢查

```
pip install torch torchvision scikit-image opencv-python-headless
python test_smoke.py
```

## Colab

1. 將本資料夾上傳至 Google Drive 之 `MyDrive/KMT-FaceDetection`，成對資料壓縮為 `MyDrive/pairs.zip`。
2. 執行階段類型選擇 T4 GPU，依序執行：

```python
from google.colab import drive
drive.mount('/content/drive')
%cd /content/drive/MyDrive/KMT-FaceDetection
!python test_smoke.py
# 資料解壓至本機磁碟；直接自 Drive 讀取大量小檔會很慢
!unzip -q /content/drive/MyDrive/pairs.zip -d /content/data
!python train.py --data /content/data/pairs --out /content/drive/MyDrive/kmt_runs/full
!python eval.py --data /content/data/pairs --ckpt /content/drive/MyDrive/kmt_runs/full/last.pt
!python infer.py --video in.mp4 --ckpt /content/drive/MyDrive/kmt_runs/full/last.pt --out out.mp4
```

`--out` 務必指向 Drive：免費版連線中斷後，重新執行同一行 `train.py` 即自上次完成之 epoch 繼續。

## 影片推論

```
python infer.py --video in.mp4 --ckpt runs/full/last.pt --out out.mp4
```

- `--margin`（預設 1.3）：裁切邊長相對於偵測框之倍率，須調整至裁切範圍與訓練資料之人臉取景一致。
- `--smooth`（預設 0.5）：前一幀裁切框之權重；越高畫面越穩定，但跟隨快速移動之能力越差。
- 限制：僅處理每幀最大之一張正面人臉；輸出不含音軌。

## 消融實驗

```
--stages 1          單級 U-Net（對照組）
--lambda-perc 0     不使用感知損失
--lambda-temp 0     不使用時間一致性損失
--degrade-p 0       訓練時不加入劣化輸入
```

每組實驗使用不同之 `--out`。

## 尚未實作

- 成對資料之產生（以現成妝容遷移模型為素顏影像上妝）
- 身分保持評估（ArcFace 相似度）與影片之時間一致性指標
