// Registry rows are either frame detectors (YOLO .pt, used for ingest / tracking) or clip classifiers
// (the VideoMAE assault model). Detector pickers must not offer classifiers.
export function isDetectorModel(m: { model_type?: string | null }): boolean {
  return (m.model_type || '').toLowerCase() !== 'videomae'
}
