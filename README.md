# AI-Based-Sales-CRM

## OCR setup

The business-card OCR feature needs a Python environment with the OCR dependencies installed.

Requirements file:

```text
backend/ocr/runtime/requirements.txt
```

Recommended setup on a new machine:

```bash
cd backend/ocr/runtime
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Then point the backend to that Python if needed:

```bash
OCR_PYTHON_EXEC=backend/ocr/runtime/.venv/Scripts/python.exe
```

Notes:

- If `backend/ocr/runtime/.venv` exists, the backend will try to use it first.
- If OCR dependencies are missing, the backend now stays up and the OCR route returns a clear `503` error instead of crashing the whole server.
- The bundled OCR ML model was trained with a newer scikit-learn pickle format; the runtime now repairs the known `LogisticRegression.multi_class` mismatch automatically during load.

## Expense OCR setup

The expense receipt OCR route uses the Node backend service in `backend/services/expenseReceiptOcr.js`.

Recommended local setup:

```bash
cd backend
python -m venv .venv-ocr
.venv-ocr\Scripts\activate
pip install -r expense_ocr_ml/requirements.txt
pip install opencv-python pytesseract easyocr pillow numpy
```

Optional environment variables:

```bash
EXPENSE_OCR_PYTHON_EXEC=backend/.venv-ocr/Scripts/python.exe
OCR_PYTHON_EXEC=backend/ocr/runtime/.venv/Scripts/python.exe
```

Notes:

- Expense OCR can still run with `tesseract.js` even if Python preprocessing is unavailable.
- Keep `eng.traineddata` available in the project root (or `backend/`) for offline OCR.
