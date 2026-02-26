export class ResponseNormalizer {
  normalize(value) {
    const unwrapped = this.unwrap(value);
    if (typeof unwrapped === "string") {
      const trimmed = unwrapped.trim();
      if (!trimmed) {
        return [];
      }
      try {
        return JSON.parse(trimmed);
      } catch {
        return unwrapped;
      }
    }
    return unwrapped;
  }

  unwrap(value) {
    if (Array.isArray(value)) {
      if (value.length > 0 && value.every((item) => item && typeof item === "object" && item.type === "text")) {
        const text = value.map((item) => String(item.text ?? "")).join("\n").trim();
        return text;
      }
      return value;
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    if (Object.prototype.hasOwnProperty.call(value, "standardized")) {
      return this.unwrap(value.standardized);
    }
    if (Object.prototype.hasOwnProperty.call(value, "raw")) {
      return this.unwrap(value.raw);
    }
    if (Object.prototype.hasOwnProperty.call(value, "result")) {
      return this.unwrap(value.result);
    }

    if (Array.isArray(value.content)) {
      const structured = value.content.find((item) => item && typeof item === "object" && "structuredContent" in item);
      if (structured) {
        return this.unwrap(structured.structuredContent);
      }
      const textBlock = value.content.find((item) => item && typeof item === "object" && item.type === "text");
      if (textBlock && typeof textBlock.text === "string") {
        return this.unwrap(textBlock.text);
      }
    }

    return value;
  }
}

