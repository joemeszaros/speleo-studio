import { toAscii } from '../utils/utils.js';

class Exporter {

  static exportAsJson = (obj, filename) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type : 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  static exportCaves(caves) {
    caves.forEach((cave) => {
      Exporter.exportAsJson(cave.toExport(), cave.name);
    });
  }

  static exportPNG(scene) {
    scene.view.renderView();
    //TODO: include compass and ratio
    const base64 = scene.domElement.toDataURL('image/png');
    let a = document.createElement('a'); // Create a temporary anchor.
    a.href = base64;
    a.download = 'export.png';
    a.click();
  }

  static exportDXF(caves) {
    const lines = [];
    var handle = 1;

    lines.push('  0');
    lines.push('SECTION');
    lines.push('  2');
    lines.push('ENTITIES');

    caves.values().forEach((cave) => {
      cave.surveys.forEach((survey) => {
        survey.shots.forEach((shot) => {

          const fromSt = cave.stations.get(shot.from);
          const toSt = cave.stations.get(shot.to);

          lines.push('  0');
          lines.push('LINE');
          lines.push('  5');
          lines.push(handle++);
          lines.push('  8');
          lines.push('POLYGON');
          lines.push('  10');
          lines.push(fromSt.position.x);
          lines.push('  20');
          lines.push(fromSt.position.y);
          lines.push('  30');
          lines.push(fromSt.position.z);
          lines.push('  11');
          lines.push(toSt.position.x);
          lines.push('  21');
          lines.push(toSt.position.y);
          lines.push('  31');
          lines.push(toSt.position.z);

        });

        cave.stations.forEach((st, name) => {
          lines.push('  0');
          lines.push('TEXT');
          lines.push('  5');
          lines.push(handle++);
          lines.push('  8');
          lines.push('POINTNAME');
          lines.push('  10');
          lines.push(st.position.x);
          lines.push('  20');
          lines.push(st.position.y);
          lines.push('  30');
          lines.push(st.position.z);
          lines.push('  40');
          lines.push('0.5');
          lines.push('  1');
          lines.push(toAscii(name));

          lines.push('  0');
          lines.push('CIRCLE');
          lines.push('  5');
          lines.push(handle++);
          lines.push('  8');
          lines.push('CIRCLES');
          lines.push('  10');
          lines.push(st.position.x);
          lines.push('  20');
          lines.push(st.position.y);
          lines.push('  30');
          lines.push(st.position.z);
          lines.push('  40');
          lines.push('0.2');
        });
      });
    });

    lines.push('  0');
    lines.push('ENDSEC');
    lines.push('  0');
    lines.push('EOF');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `speleo-studio-export.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export { Exporter };
