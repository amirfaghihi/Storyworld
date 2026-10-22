declare module 'svg-path-parser' {
  const parser: { parseSVG: (d: string) => any[]; makeAbsolute: (cmds: any[]) => any[] }
  export default parser
}
