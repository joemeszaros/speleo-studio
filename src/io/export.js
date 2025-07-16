import { toAscii, textToIso88592Bytes, toPolygonDate } from '../utils/utils.js';

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
          lines.push('  5'); // hande id, sort of object identifier
          lines.push(handle++);
          lines.push('  8'); // layer name
          lines.push('POLYGON'); // layer name
          lines.push('  10'); // x coordinate
          lines.push(fromSt.position.x);
          lines.push('  20'); // y coordinate
          lines.push(fromSt.position.y);
          lines.push('  30'); // z coordinate
          lines.push(fromSt.position.z);
          lines.push('  11'); // x coordinate
          lines.push(toSt.position.x);
          lines.push('  21'); // y coordinate
          lines.push(toSt.position.y);
          lines.push('  31'); // z coordinate
          lines.push(toSt.position.z);

        });

        cave.stations.forEach((st, name) => {
          lines.push('  0');
          lines.push('TEXT');
          lines.push('  5'); // hande id, sort of object identifier
          lines.push(handle++);
          lines.push('  8'); // layer name
          lines.push('POINTNAME');
          lines.push('  10'); // x coordinate
          lines.push(st.position.x);
          lines.push('  20'); // y coordinate
          lines.push(st.position.y);
          lines.push('  30'); // z coordinate
          lines.push(st.position.z);
          lines.push('  40'); // height
          lines.push('0.5');
          lines.push('  1'); // text
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

  static exportPolygon(caves) {
    const lines = [];

    lines.push('POLYGON Cave Surveying Software');
    lines.push('Polygon Program Version   = 2');
    lines.push('Polygon Data File Version = 1');
    lines.push('1998-2001 ===> Prepostffy Zsolt');
    lines.push('-------------------------------');
    lines.push('');

    caves.values().forEach((cave) => {

      lines.push('*** Project ***');
      lines.push(`Project name: ${cave.name}`);
      lines.push(`Project place: ${cave.metaData.settlement}`);
      lines.push(`Project code: ${cave.metaData.catasterCode}`);
      lines.push(`Made by: ${cave.metaData.creator}`);
      lines.push(`Made date: ${toPolygonDate(cave.metaData.date)}`);
      lines.push('Last modi: 0');
      lines.push('AutoCorrect: 0');
      lines.push('AutoSize: 12,0');
      lines.push('');
      lines.push('*** Surveys ***');

      cave.surveys.forEach((survey) => {
        lines.push(`Survey name: ${survey.name}`);
        lines.push(`Survey team: ${survey.metadata.team.name}`);
        for (let i = 0; i < 5; i++) {
          lines.push(`${survey.metadata.team.members[i]?.name ?? ''}	`);
        }
        lines.push(`Survey date: ${toPolygonDate(survey.metadata.date)}`);
        lines.push(`Declination: ${survey.metadata.declination}`);
        lines.push('Instruments: ');
        survey.metadata.instruments.forEach((instrument) => {
          lines.push(`${instrument.name}	${instrument.value}`);
        });
        lines.push(`Fix point: ${survey.start}`);
        const startSt = cave.stations.get(survey.start);
        lines.push(`${startSt.position.x}	${startSt.position.y}	${startSt.position.z}	0	0	0	0`);
        lines.push('Survey data');
        lines.push('From	To	Length	Azimuth	Vertical	Label	Left	Right	Up	Down	Note');

        survey.shots.forEach((shot) => {
          lines.push(
            [shot.from, shot.to, shot.length, shot.azimuth, shot.clino, '', '0', '0', '0', '0', shot.comment].join('\t')
          );

        });
        lines.push('');
      });
    });

    lines.push('End of survey data.');
    lines.push('');
    lines.push('*** Surface ***');
    lines.push('End of surface data.');
    lines.push('');
    lines.push('EOF.');

    // Convert string to ISO-8859-2 encoding
    const text = lines.join('\n');
    // it's funny but there is no textencoder for iso-8859-2 encoding so we need to convert it manually
    const iso88592Bytes = textToIso88592Bytes(text);
    const blob = new Blob([iso88592Bytes], { type: 'text/plain;charset=iso-8859-2' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polygon-export.cave`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export { Exporter };
