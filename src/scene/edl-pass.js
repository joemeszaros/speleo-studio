/*
 * Copyright 2026 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as THREE from 'three';

const EDL_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const EDL_FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform vec2 resolution;
uniform float radius;
uniform float strength;
uniform float cameraNear;
uniform float cameraFar;
uniform bool perspective;

varying vec2 vUv;

const vec2 OFFSETS[8] = vec2[8](
  vec2(1.0, 0.0),
  vec2(0.70710678, 0.70710678),
  vec2(0.0, 1.0),
  vec2(-0.70710678, 0.70710678),
  vec2(-1.0, 0.0),
  vec2(-0.70710678, -0.70710678),
  vec2(0.0, -1.0),
  vec2(0.70710678, -0.70710678)
);

float linearizeDepth(float depthSample) {
  if (depthSample >= 1.0) {
    return 1.0;
  }

  if (!perspective) {
    return depthSample;
  }

  float z = depthSample * 2.0 - 1.0;
  float linear = (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
  return (linear - cameraNear) / (cameraFar - cameraNear);
}

void main() {
  vec4 baseColor = texture2D(colorTexture, vUv);
  float centerDepthRaw = texture2D(depthTexture, vUv).r;

  if (centerDepthRaw >= 0.9999) {
    gl_FragColor = baseColor;
    return;
  }

  float centerDepth = linearizeDepth(centerDepthRaw);
  vec2 texel = vec2(1.0) / resolution;
  float accum = 0.0;

  for (int i = 0; i < 8; ++i) {
    vec2 uv = clamp(vUv + OFFSETS[i] * radius * texel, vec2(0.0), vec2(1.0));
    float neighborDepthRaw = texture2D(depthTexture, uv).r;

    if (neighborDepthRaw >= 0.9999) {
      continue;
    }

    float neighborDepth = linearizeDepth(neighborDepthRaw);
    accum += max(0.0, neighborDepth - centerDepth);
  }

  float shade = exp(-strength * accum);
  gl_FragColor = vec4(baseColor.rgb * shade, baseColor.a);
}
`;

class EdlPass {
  constructor(width, height, params = {}) {
    this._renderTarget = new THREE.WebGLRenderTarget(Math.max(1, width), Math.max(1, height), {
      minFilter : THREE.LinearFilter,
      magFilter : THREE.LinearFilter,
      format    : THREE.RGBAFormat
    });
    this._renderTarget.depthTexture = new THREE.DepthTexture(Math.max(1, width), Math.max(1, height), THREE.FloatType);
    this._renderTarget.depthTexture.format = THREE.DepthFormat;
    this._renderTarget.depthBuffer = true;

    this._postScene = new THREE.Scene();
    this._postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._postMaterial = new THREE.ShaderMaterial({
      uniforms : {
        colorTexture : { value: this._renderTarget.texture },
        depthTexture : { value: this._renderTarget.depthTexture },
        resolution   : { value: new THREE.Vector2(Math.max(1, width), Math.max(1, height)) },
        radius       : { value: 1.5 },
        strength     : { value: 1.0 },
        cameraNear   : { value: 0.1 },
        cameraFar    : { value: 1000.0 },
        perspective  : { value: true }
      },
      vertexShader   : EDL_VERTEX_SHADER,
      fragmentShader : EDL_FRAGMENT_SHADER,
      depthTest      : false,
      depthWrite     : false
    });

    this._postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._postMaterial);
    this._postScene.add(this._postQuad);

    this.setParams(params);
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this._renderTarget.setSize(w, h);
    this._postMaterial.uniforms.resolution.value.set(w, h);
  }

  setParams({ radius, strength } = {}) {
    if (radius !== undefined) {
      this._postMaterial.uniforms.radius.value = radius;
    }
    if (strength !== undefined) {
      this._postMaterial.uniforms.strength.value = strength;
    }
  }

  render(renderer, scene, camera) {
    this._postMaterial.uniforms.cameraNear.value = camera.near;
    this._postMaterial.uniforms.cameraFar.value = camera.far;
    this._postMaterial.uniforms.perspective.value = camera.isPerspectiveCamera === true;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;

    renderer.autoClear = true;
    renderer.setRenderTarget(this._renderTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = false;
    renderer.render(this._postScene, this._postCamera);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this._postQuad.geometry.dispose();
    this._postMaterial.dispose();
    this._renderTarget.dispose();
  }
}

export { EdlPass };
