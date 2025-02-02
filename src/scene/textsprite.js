import * as THREE from 'three';

class TextSprite {

  constructor(label, position, font, scale = 0.5) {
    this.font = {
      size        : font.size,
      color       : font.color ?? 'white',
      family      : font.name ?? 'Helvetica Neue',
      background  : font.background,
      strokeColor : font.strokeColor
    };
    this.label = label;
    this.position = position;
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sprite = this.#createSprite(label, position, this.scale);
  }

  #createSprite(label, position, scale) {
    const fontStyle = `${this.font.size}px ${this.font.family}`;
    this.ctx.font = fontStyle;
    this.canvas.width = Math.ceil(this.ctx.measureText(label).width);
    this.canvas.height = this.font.size;
    this.#drawText(label, fontStyle);

    const spriteMap = new THREE.CanvasTexture(this.canvas);
    spriteMap.minFilter = THREE.LinearFilter;
    spriteMap.generateMipmaps = false;
    spriteMap.needsUpdate = true;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteMap }));
    sprite.scale.set(scale * this.canvas.width, scale * this.canvas.height, 1);
    sprite.position.copy(position);
    return sprite;
  }

  getSprite() {
    return this.sprite;
  }

  update(label) {
    if (label === this.label) return;

    this.ctx = this.canvas.getContext('2d');
    this.ctx.reset();

    const fontStyle = `${this.font.size}px ${this.font.family}`;

    if (label.length > this.label.length) {
      this.ctx.font = fontStyle;
      this.canvas.width = Math.ceil(this.ctx.measureText(label).width);
      this.canvas.style.width = this.canvas.width + 'px';
    }

    this.#drawText(label, fontStyle);

    if (label.length > this.label.length) {
      this.sprite.material.map.dispose();
      this.sprite.material.map = new THREE.CanvasTexture(this.canvas);
      this.sprite.scale.set(0.5 * this.canvas.width, 0.5 * this.canvas.height, 1);
    }
    this.sprite.material.map.needsUpdate = true;

  }

  #drawText(label, fontStyle) {
    this.ctx.font = fontStyle; //this line is required here
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = this.font.color;

    if (this.font.strokeColor) {
      this.ctx.strokeStyle = this.font.strokeColor;
      this.ctx.lineWidth = this.font.size / 6;
      this.ctx.strokeText(label, 0, 0);
    }
    this.ctx.fillText(label, 0, 0);
  }

}

export { TextSprite };
