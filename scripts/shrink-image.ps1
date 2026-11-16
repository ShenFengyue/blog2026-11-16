# 图片压缩：最大宽度 1600，JPEG 质量 86，PNG 保持无损缩放，并修正手机照片的 EXIF 方向
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$MaxWidth = 1600,
  [int]$Quality = 86
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile($In)
try {
  # 手机/相机照片常带 EXIF 方向，GDI+ 不会自动转
  $ori = 1
  try {
    if ($img.PropertyIdList -contains 0x0112) {
      $ori = [int]$img.GetPropertyItem(0x0112).Value[0]
    }
  } catch { $ori = 1 }

  switch ($ori) {
    2 { $img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX) }
    3 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
    4 { $img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipY) }
    5 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipX) }
    6 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
    7 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipX) }
    8 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
  }

  $w = $img.Width
  $h = $img.Height
  $scale = 1.0
  if ($w -gt $MaxWidth) { $scale = $MaxWidth / $w }
  $nw = [int][Math]::Round($w * $scale)
  $nh = [int][Math]::Round($h * $scale)
  if ($nw -lt 1) { $nw = 1 }
  if ($nh -lt 1) { $nh = 1 }

  $bmp = New-Object System.Drawing.Bitmap($nw, $nh)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($img, 0, 0, $nw, $nh)
  } finally {
    $g.Dispose()
  }

  $ext = [System.IO.Path]::GetExtension($Out).ToLower()
  if ($ext -eq '.jpg' -or $ext -eq '.jpeg') {
    $jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $prm = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $prm.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
    $bmp.Save($Out, $jpeg[0], $prm)
    $prm.Dispose()
  } else {
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $bmp.Dispose()

  Write-Output "$nw x $nh"
} finally {
  $img.Dispose()
}
