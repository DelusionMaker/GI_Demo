// 让 TypeScript 识别 vite-plugin-glsl 导入的着色器文件为字符串模块。
declare module '*.glsl' {
  const value: string
  export default value
}
declare module '*.vert' {
  const value: string
  export default value
}
declare module '*.frag' {
  const value: string
  export default value
}
declare module '*.geom' {
  const value: string
  export default value
}
declare module '*.comp' {
  const value: string
  export default value
}
