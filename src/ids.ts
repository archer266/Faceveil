// Region IDs only need to be unique within this open editor. A counter works on
// local-network HTTP pages, where crypto.randomUUID() is unavailable.
let nextId = 0

export function newRegionId() {
  return `face-${++nextId}`
}
