// Port of org.grobid.core.data.Metadata.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/Metadata.java

export class Metadata {
  private title: string | null = null;
  private subject: string | null = null;
  private keywords: string | null = null;
  private author: string | null = null;
  private creator: string | null = null;
  private producer: string | null = null;
  private createDate: string | null = null;
  private modificationDate: string | null = null;

  getTitle(): string | null {
    return this.title;
  }

  setTitle(title: string | null): void {
    this.title = title;
  }

  getSubject(): string | null {
    return this.subject;
  }

  setSubject(subject: string | null): void {
    this.subject = subject;
  }

  getAuthor(): string | null {
    return this.author;
  }

  setAuthor(author: string | null): void {
    this.author = author;
  }

  getCreator(): string | null {
    return this.creator;
  }

  setCreator(creator: string | null): void {
    this.creator = creator;
  }

  getProducer(): string | null {
    return this.producer;
  }

  setProducer(producer: string | null): void {
    this.producer = producer;
  }

  getCreateDate(): string | null {
    return this.createDate;
  }

  setCreateDate(createDate: string | null): void {
    this.createDate = createDate;
  }

  getModificationDate(): string | null {
    return this.modificationDate;
  }

  setModificationDate(modificationDate: string | null): void {
    this.modificationDate = modificationDate;
  }

  getKeywords(): string | null {
    return this.keywords;
  }

  setKeywords(keywords: string | null): void {
    this.keywords = keywords;
  }
}
