/**
 * Centralized Roboflow-style class color palette utility for TraceNet.
 * Provides deterministic, distinct colors for object classes.
 */
export const NAMED_CLASS_COLORS: Record<string, string> = {
  person:        '#FF3838', // vivid red
  car:           '#FF9D97', // salmon pink
  truck:         '#FF701F', // deep orange
  bus:           '#FFB21D', // amber gold
  motorcycle:    '#CFD231', // lime yellow
  bicycle:       '#48F90A', // neon green
  backpack:      '#92E1C0', // mint
  handbag:       '#37D3FF', // sky blue
  suitcase:      '#2F72FF', // royal blue
  cat:           '#3DDB86',
  dog:           '#1A9334',
  bird:          '#00D4BB',
  horse:         '#2C99A8',
  cow:           '#00C2FF',
  sheep:         '#344593',
  airplane:      '#6473FF',
  boat:          '#0018EC',
  train:         '#8438FF',
  traffic_light: '#520085',
  stop_sign:     '#CB38FF',
  fire_hydrant:  '#FF95C8',
}

export const FALLBACK_PALETTE = [
  '#E6194B','#3CB44B','#4363D8','#F58231','#911EB4',
  '#42D4F4','#F032E6','#BFEF45','#FABED4','#469990',
  '#DCBEFF','#9A6324',
]

export function classColor(className?: string): string {
  if (!className) return '#00C9B8'
  const key = className.toLowerCase()
  if (NAMED_CLASS_COLORS[key]) return NAMED_CLASS_COLORS[key]

  let hash = 5381
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash) + key.charCodeAt(i)
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length]
}
