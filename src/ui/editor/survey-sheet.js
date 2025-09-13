import { Declination, MeridianConvergence } from '../../utils/geo.js';
import { BaseEditor } from './base.js';
import { SurveyMetadata, Survey, SurveyTeam, SurveyTeamMember, SurveyInstrument } from '../../model/survey.js';
import { showErrorPanel } from '../popups.js';
import { i18n } from '../../i18n/i18n.js';
import * as U from '../../utils/utils.js';
import { wm } from '../window.js';

export class SurveySheetEditor extends BaseEditor {

  constructor(db, cave, survey, panel, declinationCache) {
    super(panel);
    this.panel = panel;
    this.db = db;
    this.cave = cave;
    this.survey = survey;
    this.declinationCache = declinationCache;
    document.addEventListener('languageChanged', () => this.setupPanel());
  }

  setupPanel() {
    wm.makeFloatingPanel(
      this.panel,
      (contentElmnt) => this.buildForm(contentElmnt),
      () =>
        i18n.t('ui.editors.surveySheet.title', {
          name : this.survey?.name || i18n.t('ui.editors.surveySheet.titleNew')
        }),
      false,
      false,
      {},
      () => {
        this.closeEditor();
      }
    );
  }

  buildForm(contentElmnt) {

    this.formData = {
      name        : this.survey?.name || '',
      start       : this.survey?.start || '',
      date        : this.survey?.metadata?.date ? U.formatDateISO(this.survey.metadata.date) : '',
      declination : this.survey?.metadata?.declination ?? '',
      convergence : this.survey?.metadata?.convergence ?? '',
      team        : this.survey?.metadata?.team?.name || '',
      members     : (this.survey?.metadata?.team?.members || []).map((m) => ({ name: m.name, role: m.role })),
      instruments : (this.survey?.metadata?.instruments || []).map((i) => ({ name: i.name, value: i.value }))
    };

    const form = U.node`<form class="editor"></form>`;

    // Create 2-column layout
    const formGrid = U.node`<div class="sheet-editor-grid"></div>`;
    form.appendChild(formGrid);

    // Column 1: Survey name and date
    const column1 = U.node`<div class="sheet-editor-column"></div>`;
    formGrid.appendChild(column1);

    // Column 2: Start station and declination
    const column2 = U.node`<div class="sheet-editor-column"></div>`;
    formGrid.appendChild(column2);

    // Team field (full width)
    const teamField = U.node`<div class="sheet-editor-full-width"></div>`;
    formGrid.appendChild(teamField);

    this.surveyHasChanged = false;
    this.nameHasChanged = false;

    // Helper function to create form field
    const createField = (f, container) => {
      let value = this.formData[f.id];
      const input = U.node`<input type="${f.type}" id="${f.id}" name="${f.id}" value="${value ?? ''}" ${f.required ? 'required' : ''} ${f.step ? 'step="' + f.step + '"' : ''}>`;
      input.oninput = (e) => {
        if (this.formData[f.id] !== e.target.value) {
          this.surveyHasChanged = true;
          if (f.id === 'name') {
            this.nameHasChanged = true;
            if (this.cave.hasSurvey(e.target.value)) {
              showErrorPanel(
                i18n.t('ui.editors.surveySheet.messages.surveyNameAlreadyExists', { name: e.target.value })
              );
            }
          }
          this.formData[f.id] = e.target.value;
        }
      };
      const label = U.node`<label class="sheet-editor-label" for="${f.id}">${f.label}: </label>`;
      const fieldContainer = U.node`<div class="sheet-editor-field"></div>`;
      fieldContainer.appendChild(label);
      fieldContainer.appendChild(input);
      container.appendChild(fieldContainer);
    };

    // Column 1: Survey name and date
    createField(
      {
        label    : i18n.t('ui.editors.surveySheet.fields.name'),
        id       : 'name',
        type     : 'text',
        required : true
      },
      column1
    );

    createField(
      {
        label    : i18n.t('ui.editors.surveySheet.fields.date'),
        id       : 'date',
        type     : 'date',
        required : true
      },
      column1
    );

    // Column 2: Start station and declination
    createField(
      {
        label : i18n.t('ui.editors.surveySheet.fields.start'),
        id    : 'start',
        type  : 'text'
      },
      column2
    );

    createField(
      {
        label    : i18n.t('ui.editors.surveySheet.fields.declination'),
        id       : 'declination',
        type     : 'number',
        step     : 'any',
        required : true
      },
      column2
    );

    // Team field (full width)
    createField(
      {
        label    : i18n.t('ui.editors.surveySheet.fields.team'),
        id       : 'team',
        type     : 'text',
        required : false
      },
      teamField
    );
    const columns = U.node`<div class="columns"></div>`;
    form.appendChild(columns);

    const membersDiv = U.node`<div class="team-members-section"><b>${i18n.t('ui.editors.surveySheet.fields.teamMembers')}:</b><br/><br/></div>`;
    this.membersList = U.node`<div class="members-list"></div>`;
    membersDiv.appendChild(this.membersList);
    columns.appendChild(membersDiv);
    this.renderMembers();

    const instrumentsDiv = U.node`<div class="instruments-section"><b>${i18n.t('ui.editors.surveySheet.fields.instruments')}:</b><br/><br/></div>`;
    this.instrumentsList = U.node`<div class="instruments-list"></div>`;
    instrumentsDiv.appendChild(this.instrumentsList);
    columns.appendChild(instrumentsDiv);
    this.renderInstruments();

    const saveBtn = U.node`<button type="submit">${i18n.t('common.save')}</button>`;
    const cancelBtn = U.node`<button type="button">${i18n.t('common.cancel')}</button>`;
    cancelBtn.onclick = (e) => {
      e.preventDefault();
      this.closeEditor();
    };
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);

    form.appendChild(
      U.node`<p>${i18n.t('ui.editors.surveySheet.fields.convergence')}: ${this.survey?.metadata?.convergence?.toFixed(3) || i18n.t('ui.editors.surveySheet.errors.notAvailable')}</p>`
    );
    const declinationText = U.node`<p id="declination-official">${i18n.t('ui.editors.surveySheet.fields.declination')}: ${i18n.t('ui.editors.surveySheet.errors.unavailable')}</p>`;
    form.appendChild(declinationText);
    if (this.cave.stations.size > 0) {
      const startOrRandomStation = this.cave.stations
        ? (this.cave.stations.get(this.survey?.start) ?? this.cave.stations.entries().next().value[1])
        : undefined;
      const declinationPrefix = i18n.t('ui.editors.surveySheet.messages.declinationPrefix');
      if (this.survey?.metadata?.declinationReal === undefined) {
        if (startOrRandomStation?.coordinates?.wgs !== undefined && this.survey?.metadata?.date !== undefined) {
          Declination.getDeclination(
            this.declinationCache,
            startOrRandomStation.coordinates.wgs.lat,
            startOrRandomStation.coordinates.wgs.lon,
            this.survey.metadata.date
          ).then((declination) => {
            this.survey.metadata.declinationReal = declination;
            declinationText.textContent = `${declinationPrefix} ${declination.toFixed(3)}`;
          });
        } else {
          declinationText.textContent = `${declinationPrefix} ${i18n.t('ui.editors.surveySheet.errors.noWgs84Coordinates')}`;
        }
      } else {
        declinationText.textContent = `${declinationPrefix} ${this.survey.metadata.declinationReal.toFixed(3)}`;
      }
    }

    form.onsubmit = (e) => {
      e.preventDefault();

      const teamMembers = this.formData.members.map((m) => new SurveyTeamMember(m.name, m.role));
      const team = new SurveyTeam(this.formData.team, teamMembers);
      const instruments = this.formData.instruments.map((i) => new SurveyInstrument(i.name, i.value));
      const metadata = new SurveyMetadata(
        this.formData.date ? new Date(this.formData.date) : undefined,
        this.formData.declination ? parseFloat(this.formData.declination) : undefined,
        this.formData.convergence ? parseFloat(this.formData.convergence) : undefined,
        team,
        instruments
      );

      if (this.survey !== undefined && this.nameHasChanged && this.formData.name !== this.survey.name) {
        if (this.cave.hasSurvey(this.formData.name)) {
          showErrorPanel(
            i18n.t('ui.editors.surveySheet.messages.surveyNameAlreadyExists', { name: this.formData.name })
          );
          return;
        } else {
          const oldName = this.survey.name;
          this.db.renameSurvey(this.cave, oldName, this.formData.name);
          //TODO: this is a race condition with survey change event coming shortly after this
          // the cave objects and materials have to be renamed until the survey change event is processed
          this.#emitSurveyRenamed(this.cave, this.survey, oldName);
        }
      }

      if ((this.survey?.shots ?? []).length > 0) {
        const hasStart = this.survey.shots.find((s) => s.from === this.formData.start || s.to === this.formData.start);
        if (hasStart === undefined) {
          showErrorPanel(
            i18n.t('ui.editors.surveySheet.messages.startStationNotFound', { start: this.formData.start })
          );
          return;
        }
      }

      if (this.survey === undefined) {

        if (this.cave.hasSurvey(this.formData.name)) {
          showErrorPanel(
            'Cannot add new survey: ' +
              i18n.t('ui.editors.surveySheet.messages.surveyNameAlreadyExists', { name: this.formData.name })
          );
          return;
        }

        // this is a new survey
        if (this.cave.surveys.size > 0) {
          // get convergence from first existing survey
          metadata.convergence = this.cave.surveys.entries().next().value[1].metadata.convergence;
        } else if (this.cave.geoData !== undefined && this.cave.geoData.coordinates.length > 0) {
          //get convergence based on the first fix point of the cave
          const fixPoint = this.cave.geoData.coordinates[0]; // this must be an eov coordinate
          metadata.convergence = MeridianConvergence.getConvergence(fixPoint.coordinate.y, fixPoint.coordinate.x);
        }
        this.survey = new Survey(this.formData.name, true, metadata, this.formData.start);
        this.#emitSurveyAdded();
      } else if (this.surveyHasChanged) {

        this.survey.metadata = metadata;
        this.survey.start = this.formData.start;
        this.#emitSurveyChanged();
      }
      this.closeEditor();
    };
    contentElmnt.appendChild(form);

  }

  renderMembers() {
    this.renderListEditor({
      container : this.membersList,
      items     : this.formData.members,
      fields    : [
        { key: 'name', placeholder: i18n.t('ui.editors.surveySheet.fields.memberName'), type: 'text', width: '120px' },
        { key: 'role', placeholder: i18n.t('ui.editors.surveySheet.fields.memberRole'), type: 'text', width: '100px' }
      ],
      nodes : [],
      onAdd : () => {
        this.formData.members.push({ name: '', role: '' });
        this.renderMembers();
        this.surveyHasChanged = true;
      },
      onRemove : (idx) => {
        this.formData.members.splice(idx, 1);
        this.renderMembers();
        this.surveyHasChanged = true;
      },
      onChange : (idx, key, value) => {
        if (this.formData.members[idx][key] !== value) {
          this.surveyHasChanged = true;
        }
        this.formData.members[idx][key] = value;

      },
      addButtonLabel : i18n.t('ui.editors.surveySheet.buttons.addMember')
    });
  }

  renderInstruments() {
    this.renderListEditor({
      container : this.instrumentsList,
      items     : this.formData.instruments,
      fields    : [
        {
          key         : 'name',
          placeholder : i18n.t('ui.editors.surveySheet.fields.instrumentName'),
          type        : 'text',
          width       : '140px'
        },
        {
          key         : 'value',
          placeholder : i18n.t('ui.editors.surveySheet.fields.instrumentValue'),
          type        : 'text',
          width       : '80px'
        }
      ],
      nodes : [],
      onAdd : () => {
        this.formData.instruments.push({ name: '', value: '' });
        this.renderInstruments();
        this.surveyHasChanged = true;
      },
      onRemove : (idx) => {
        this.formData.instruments.splice(idx, 1);
        this.renderInstruments();
        this.surveyHasChanged = true;
      },
      onChange : (idx, key, value) => {
        if (this.formData.instruments[idx][key] !== value) {
          this.surveyHasChanged = true;
        }
        this.formData.instruments[idx][key] = value;

      },
      addButtonLabel : i18n.t('ui.editors.surveySheet.buttons.addInstrument')
    });
  }

  #emitSurveyChanged() {
    const event = new CustomEvent('surveyChanged', {
      detail : {
        reasons : ['sheet'],
        cave    : this.cave,
        survey  : this.survey
      }
    });
    document.dispatchEvent(event);
  }

  #emitSurveyAdded() {
    const event = new CustomEvent('surveyAdded', {
      detail : {
        cave   : this.cave,
        survey : this.survey
      }
    });
    document.dispatchEvent(event);
  }

  #emitSurveyRenamed(cave, survey, oldName) {
    const event = new CustomEvent('surveyRenamed', {
      detail : {
        oldName : oldName,
        cave    : cave,
        survey  : survey
      }
    });
    document.dispatchEvent(event);
  }

}
