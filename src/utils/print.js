/*
 * Copyright 2024 Joe Meszaros
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

export class PrintUtils {

  constructor(options, scene, projectSystem) {
    this.options = options;
    this.scene = scene;
    this.projectSystem = projectSystem;
  }

  // just using window.print() doesn't work always. Firefox didn't work at all.
  // also printing a canvas of three.js doesn't work based on comments on the internet
  // I decided to save the scene to a A4 sized image and print just the image and nothing else
  // page orientation comes form the config and controlled with named @page at-rules in main.css
  async cropCanvasToImage() {

    //FIXME: in plan view the compass shoul be visible

    this.scene.view.renderView();
    const backgroundColor = this.options.scene.background.color;
    this.options.scene.background.color = '#ffffff';

    const sourceCanvas = document.getElementById('viewport').querySelector('canvas');
    const canvas = document.createElement('canvas');

    const layout = this.options.print.layout;

    const _297mm = Math.round((29.7 / 2.54) * this.options.screen.DPI);
    const _210mm = Math.round((21 / 2.54) * this.options.screen.DPI);

    if (layout === 'landscape') {
      document.body.classList.add('landscape');
      document.body.classList.remove('portrait');
      canvas.width = _297mm; // A4 landscape width at 96 DPI (11.69 inches * 96)
      canvas.height = _210mm; // A4 landscape height at 96 DPI (8.27 inches * 96)

    } else {
      document.body.classList.add('portrait');
      document.body.classList.remove('landscape');
      canvas.width = _210mm; // A4 width at 96 DPI (8.27 inches * 96)
      canvas.height = _297mm; // A4 height at 96 DPI (11.69 inches * 96)
    }

    const context = canvas.getContext('2d');

    // Calculate source dimensions to maintain A4 aspect ratio
    const sourceAspectRatio = sourceCanvas.width / sourceCanvas.height;
    const targetAspectRatio = canvas.width / canvas.height;

    let sourceWidth, sourceHeight, sourceX, sourceY;

    if (sourceAspectRatio > 1.0) {
      //wider than tall
      sourceHeight = sourceCanvas.height;
      sourceWidth = sourceCanvas.height * targetAspectRatio;
      sourceX = (sourceCanvas.width - sourceWidth) / 2;
      sourceY = 0;
    } else {
      //taller than wide
      sourceWidth = sourceCanvas.width;
      sourceHeight = sourceCanvas.width / targetAspectRatio;
      sourceX = 0;
      sourceY = (sourceCanvas.height - sourceHeight) / 2;
    }

    // Draw the image with proper cropping
    context.drawImage(sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    // Add project name at the top
    const projectName = this.projectSystem.currentProject?.name || 'Untitled Project';
    const ratio = `M 1:${this.scene.view.ratio}`;
    context.font = '20px Arial';
    context.fillStyle = '#000000';
    context.textAlign = 'center';
    context.fillText(projectName, canvas.width / 2, 40);
    context.fillText(ratio, canvas.width / 2, 60);

    const img = canvas.toDataURL('image/png');
    this.options.scene.background.color = backgroundColor;
    const imgElement = document.getElementById('export-canvas');
    imgElement.src = img;
    imgElement.width = canvas.width;
    imgElement.height = canvas.height;
    await new Promise((resolve) => setTimeout(resolve, 200));

  }

}
