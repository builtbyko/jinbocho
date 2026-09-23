export const eraLegend = [
  ["prewar", "1944年以前", "#6c3328"],
  ["1945-1969", "1945–1969", "#9e5540"],
  ["1970-1999", "1970–1999", "#c67b55"],
  ["2000-present", "2000年以降", "#e3aa75"],
  ["unknown", "年代未確認", "#c9c4b8"],
] as const;

export const categoryLabel: Record<string, string> = {
  antiquarian_bookstore: "古書店",
  bookstore: "新刊・専門書店",
  cafe: "喫茶・カフェ",
  restaurant: "飲食店",
  retail: "物販",
  culture: "文化施設",
  education: "教育",
  service: "サービス",
  other: "その他",
  unclassified: "未分類",
};

export function eraLabel(era?: string) {
  return eraLegend.find(([key]) => key === era)?.[1] ?? "年代未確認";
}
