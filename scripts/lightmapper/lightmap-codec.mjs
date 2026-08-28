const clamp = value => Math.max(0, Math.min(1, value));

export function encodeRgbm(lightmap, width, height, range = 8) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * 3;
    const maximum = Math.max(lightmap[source], lightmap[source + 1], lightmap[source + 2], 1e-6);
    const multiplier = Math.min(1, Math.ceil(Math.min(maximum / range, 1) * 255) / 255);
    for (let channel = 0; channel < 3; channel++) {
      pixels[pixel * 4 + channel] = Math.round(clamp(lightmap[source + channel] / (multiplier * range)) * 255);
    }
    pixels[pixel * 4 + 3] = Math.round(multiplier * 255);
  }
  return pixels;
}

export function encodeDirection(directionMap, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * 3;
    const length = Math.hypot(directionMap[source], directionMap[source + 1], directionMap[source + 2]) || 1;
    for (let channel = 0; channel < 3; channel++) {
      pixels[pixel * 4 + channel] = Math.round(clamp(directionMap[source + channel] / length * .5 + .5) * 255);
    }
    pixels[pixel * 4 + 3] = 255;
  }
  return pixels;
}

export function encodeAo(aoMap, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const value = Math.round(clamp(aoMap[pixel]) * 255);
    pixels.set([value, value, value, 255], pixel * 4);
  }
  return pixels;
}
