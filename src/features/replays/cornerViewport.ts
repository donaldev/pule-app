import type { Point } from './recordingGeometry'

export type Size = { width: number; height: number }
export type Viewport = { zoom: number; x: number; y: number }
export const initialViewport: Viewport = { zoom: 1, x: 0, y: 0 }

export function fitScale(stage: Size, image: Size) {
  return Math.min(stage.width / image.width, stage.height / image.height)
}

export function clampViewport(view: Viewport, stage: Size, image: Size): Viewport {
  const scale = fitScale(stage, image) * view.zoom
  const xLimit = Math.max(0, (image.width * scale - stage.width) / 2)
  const yLimit = Math.max(0, (image.height * scale - stage.height) / 2)
  return { zoom: view.zoom, x: Math.min(xLimit, Math.max(-xLimit, view.x)), y: Math.min(yLimit, Math.max(-yLimit, view.y)) }
}

export function zoomViewport(view: Viewport, zoom: number, from: Point, to: Point, stage: Size, image: Size) {
  const nextZoom = Math.min(8, Math.max(1, zoom))
  const factor = nextZoom / view.zoom
  const cx = stage.width / 2, cy = stage.height / 2
  return clampViewport({
    zoom: nextZoom,
    x: to[0] - cx - (from[0] - cx - view.x) * factor,
    y: to[1] - cy - (from[1] - cy - view.y) * factor,
  }, stage, image)
}

export function stageToImage([x, y]: Point, view: Viewport, stage: Size, image: Size): Point {
  const scale = fitScale(stage, image) * view.zoom
  return [(x - stage.width / 2 - view.x) / scale + image.width / 2,
    (y - stage.height / 2 - view.y) / scale + image.height / 2]
}

export function imageToStage([x, y]: Point, view: Viewport, stage: Size, image: Size): Point {
  const scale = fitScale(stage, image) * view.zoom
  return [(x - image.width / 2) * scale + stage.width / 2 + view.x,
    (y - image.height / 2) * scale + stage.height / 2 + view.y]
}

export function limitToImage([x, y]: Point, image: Size): Point {
  return [Math.min(image.width - 1, Math.max(0, x)), Math.min(image.height - 1, Math.max(0, y))]
}

export function replaceCorner(corners: Point[], index: number, point: Point) {
  return corners.map((corner, i) => i === index ? point : corner)
}
