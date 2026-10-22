import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

interface Props {
  text: string
  position: [number, number, number]
  /** world height of the label in metres */
  height?: number
  color?: string
  outline?: string
  spriteRef?: React.Ref<THREE.Sprite>
}

/** A billboard text label drawn to a 2D canvas. No font loading, no extra GL contexts. */
export function TextSprite({ text, position, height = 1.6, color = '#fffaf0', outline = '#2b2620', spriteRef }: Props) {
  const { texture, aspect } = useMemo(() => {
    const font = '600 44px "Iowan Old Style", Palatino, Georgia, serif'
    const pad = 16
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')!
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2
    const h = 64 + pad
    c.width = Math.max(2, w)
    c.height = h
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 8
    ctx.strokeStyle = outline
    ctx.strokeText(text, c.width / 2, h / 2)
    ctx.fillStyle = color
    ctx.fillText(text, c.width / 2, h / 2)
    const texture = new THREE.CanvasTexture(c)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    return { texture, aspect: c.width / c.height }
  }, [text, color, outline])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <sprite ref={spriteRef} position={position} scale={[height * aspect, height, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} fog={false} />
    </sprite>
  )
}
