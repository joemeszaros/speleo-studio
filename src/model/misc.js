export class RevisionInfo {
  constructor(id, revision, app, synced, originApp, originRevision, deleted = false) {
    this.id = id;
    this.revision = revision;
    this.app = app;
    this.synced = synced;
    this.originApp = originApp;
    this.originRevision = originRevision;
    this.deleted = deleted;
  }

  toExport() {
    return {
      id             : this.id,
      revision       : this.revision,
      app            : this.app,
      synced         : this.synced,
      originApp      : this.originApp,
      originRevision : this.originRevision,
      deleted        : this.deleted
    };
  }

  static fromPure(pure) {
    return Object.assign(new RevisionInfo(), pure);
  }
}
