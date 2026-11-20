export interface EbOcrResult {
  bill_amount: number;
  rr_number?: string;
  provider?: string;
  billing_period?: string;
  confidence: string;
  notes: string;
}

export interface WaterMeterOcrResult {
  meter_reading: number;
  rr_or_serial?: string;
  unit_label?: string;
  confidence: string;
  notes: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

export async function extractBillOrMeterWithGemini(
  file: File,
  mode: 'eb_bill' | 'common_eb' | 'water_meter'
): Promise<EbOcrResult | WaterMeterOcrResult> {
  const imageBase64 = await fileToBase64(file);
  const res = await fetch('/api/ocr/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64,
      mimeType: file.type || 'image/jpeg',
      mode,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `OCR extraction failed (${res.status})`);
  }

  return data.extracted;
}
