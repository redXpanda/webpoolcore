import { chromium } from 'playwright-core';
import path from 'node:path';

const output = path.resolve('public/generated/sunset-pool-hall/gi-lightmap.png');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { document.body.innerHTML = '<canvas width="512" height="512"></canvas>'; });
const ready = await page.evaluate(async () => {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return false;
  const device = await adapter.requestDevice();
  const canvas = document.querySelector('canvas');
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const module = device.createShaderModule({ code: `
    struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
    @vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
      var p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
      var out: Out; out.position = vec4f(p[index], 0, 1); out.uv = p[index] * .5 + .5; return out;
    }
    fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
    fn windowVisibility(x: f32, z: f32, y: f32) -> f32 {
      let centers = array<f32, 8>(-42,-32,-22,-12,-2,8,18,28);
      var value = 0.0;
      for (var i=0u; i<8u; i++) {
        let dz = abs(z - centers[i]); let body = y > .58 && y < 6.7;
        let arch = y >= 6.7 && dz*dz + (y-6.7)*(y-6.7) < 2.89;
        if (body || arch) { value = max(value, 1.0 - smoothstep(1.1, 1.7, dz)); }
      }
      return value;
    }
    @fragment fn fs(in: Out) -> @location(0) vec4f {
      let world = vec2f(in.uv.x * 64.0 - 32.0, (1.0 - in.uv.y) * 84.0 - 50.0);
      var irradiance = .035;
      let sun = normalize(vec3f(-.86, .2, -.46));
      for (var sample=0u; sample<24u; sample++) {
        let jitter = hash(world + vec2f(f32(sample)*.71, f32(sample)*1.37));
        let y = .8 + jitter * 4.7;
        let distance = 32.0 - world.x;
        let hitZ = world.y + distance * (.46 / .86) + (jitter - .5) * 1.4;
        let visible = windowVisibility(32.0, hitZ, y);
        irradiance += visible * (.92 / 24.0) * exp(-distance / 38.0);
        irradiance += max(0.0, dot(normalize(vec3f((jitter-.5)*.7, 1, (hash(world + vec2f(f32(sample))) - .5)*.7)), -sun)) * .008;
      }
      let poolBounce = exp(-((world.x*world.x)/520.0 + ((world.y+8.0)*(world.y+8.0))/1350.0)) * .11;
      let warm = clamp(irradiance + poolBounce, 0.0, 1.0);
      return vec4f(warm, warm*.55, warm*.2 + .015, 1.0);
    }
  ` });
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(pipeline); pass.draw(3); pass.end(); device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return true;
});
if (!ready) {
  await browser.close();
  console.warn('GPU GI unavailable; retaining CPU bake output');
  process.exit(0);
}
await page.screenshot({ path: output });
await browser.close();
console.log(`GPU-baked GI lightmap: ${output}`);
