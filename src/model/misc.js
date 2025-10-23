export class RevisionInfo {
  constructor(id, revision, app, reason) {
    this.id = id;
    this.revision = revision;
    this.app = app;
    this.reason = reason;
  }

  toExport() {
    return {
      id       : this.id,
      revision : this.revision,
      app      : this.app,
      reason   : this.reason
    };
  }

  static fromPure(pure) {
    return Object.assign(new RevisionInfo(), pure);
  }
}
