/**
 * 監視設定に含まれる文字列系フィルタを扱う補助関数群。
 * DynamoDB 由来の string / list / set を正規化し、タイトル包含条件を評価する。
 */
export const normalizeStringListInput = (value: unknown): unknown => {
  if (value instanceof Set) {
    return Array.from(value);
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (entry instanceof Set) {
        return Array.from(entry);
      }

      return [entry];
    });
  }

  if (typeof value === 'string') {
    return [value];
  }

  return value;
};

export const matchesTitleIncludes = (
  title: string,
  titleIncludes?: string[]
): boolean => {
  if (!titleIncludes || titleIncludes.length === 0) {
    return true;
  }

  return titleIncludes.some((keyword) => title.includes(keyword));
};
