# Tesseract (lecture de l'écriture, pour le sens des dessins)

- `tesseract.min.js`, `worker.min.js` : tesseract.js 7.0.0 (Apache-2.0, LICENSE-tesseract.js.md)
- `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-lstm.wasm.js` : tesseract.js-core 6.1.2 (Apache-2.0, LICENSE-tesseract-core), moteur LSTM seul, avec et sans SIMD
- `fra.traineddata.gz` : modèle français « best_int » de @tesseract.js-data/fra 1.0.0 (tessdata_best, Apache-2.0)

Chargés à la demande par `js/app.js` (`openReader`), uniquement à l'import de nouveaux dessins.
