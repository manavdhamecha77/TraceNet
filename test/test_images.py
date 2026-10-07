import os
import re
import cv2
from pathlib import Path
from ultralytics import YOLO
from fast_plate_ocr import LicensePlateRecognizer

# Setup paths
PROJECT_ROOT = Path(__file__).resolve().parent
MODEL_PATH = PROJECT_ROOT / "license-plate-finetune-v1n_fixed.pt"
OUTPUT_DIR = PROJECT_ROOT / "predict_results"
TEXT_OUTPUT = PROJECT_ROOT / "ocr_results.txt"

def main():
    if not MODEL_PATH.exists():
        print(f"Error: Model not found at {MODEL_PATH}")
        return
    
    print(f"[+] Loading models...")
    model = YOLO(str(MODEL_PATH))
    ocr_engine = LicensePlateRecognizer("cct-s-v2-global-model")
    
    # Find all jpeg images in the test directory
    image_paths = list(PROJECT_ROOT.glob("*.jpeg"))
    if not image_paths:
        print(f"Error: No .jpeg images found in {PROJECT_ROOT}")
        return
        
    print(f"[+] Found {len(image_paths)} images to process.")
    
    # Run prediction on all images
    results = model.predict(
        source=[str(p) for p in image_paths],
        save=True,
        project=str(PROJECT_ROOT),
        name="predict_results",
        exist_ok=True
    )
    
    # Process OCR and save to text file
    with open(TEXT_OUTPUT, "w", encoding="utf-8") as f:
        f.write("Filename\tLicense_Plate\n")
        f.write("-" * 50 + "\n")
        
        for r in results:
            orig_path = r.path
            filename = Path(orig_path).name
            img = r.orig_img
            
            plates_found = []
            
            if r.boxes and len(r.boxes) > 0:
                # Sort boxes by confidence if multiple plates
                boxes = sorted(r.boxes, key=lambda b: float(b.conf[0]), reverse=True)
                for box in boxes:
                    lx1, ly1, lx2, ly2 = box.xyxy[0].cpu().numpy().astype(int)
                    lx1, ly1 = max(0, lx1), max(0, ly1)
                    lx2, ly2 = min(img.shape[1], lx2), min(img.shape[0], ly2)
                    
                    if lx2 > lx1 and ly2 > ly1:
                        lp_cutout = img[ly1:ly2, lx1:lx2]
                        try:
                            # Run fast-plate-ocr on the cropped region
                            ocr_res = ocr_engine.run(lp_cutout)
                            
                            # Parse the result
                            if isinstance(ocr_res, list) and len(ocr_res) > 0:
                                raw_text = getattr(ocr_res[0], 'plate', str(ocr_res[0]))
                            else:
                                raw_text = getattr(ocr_res, 'plate', str(ocr_res))
                                
                            clean_text = re.sub(r"[^A-Z0-9]", "", raw_text.upper()).strip()
                            plate_text = clean_text if clean_text else "UNREADABLE"
                        except Exception as e:
                            plate_text = "OCR_ERROR"
                            
                        plates_found.append(plate_text)
            
            if not plates_found:
                plates_found.append("NO_PLATE_DETECTED")
                
            plates_str = ", ".join(plates_found)
            print(f"  {filename} -> {plates_str}")
            f.write(f"{filename}\t{plates_str}\n")
            
    print(f"\n[+] Processing complete! OCR results saved to: {TEXT_OUTPUT}")
    print(f"[+] Annotated images are in: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
