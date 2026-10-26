# Modèles servis à l'atelier

`birefnet-lite.onnx.part0`, `.part1`, `.part2` : BiRefNet general lite (épine Swin-tiny, epoch 232), au format
ONNX, tel que distribué par rembg (`BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx`, md5
`4fab47adc4ff364be1713e97b7e66334`, licence MIT), découpé en trois morceaux de 75 Mo (un fichier de plus de
100 Mo ne tient pas dans un dépôt GitHub). L'atelier (`js/ai-cut.js`) les télécharge une fois, les met bout
à bout et les garde dans le cache du navigateur. Pour reconstituer le fichier : `cat birefnet-lite.onnx.part* > birefnet-lite.onnx`.
