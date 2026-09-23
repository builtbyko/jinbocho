import type { ThemeKey } from "./types";

export const themeLabels: Record<ThemeKey, { label: string; short: string; description: string }> = {
  use: {
    label: "地上階優先の店舗用途",
    short: "用途",
    description: "階情報がある店は地上階を優先し、未確認の店は路面店候補として建物へ結びます。",
  },
  bookEra: {
    label: "古書店の創業年代",
    short: "古書店年代",
    description: "店の創業年を比較します。神保町での開業年・現在地への移転年とは区別しています。",
  },
  food: {
    label: "喫茶と食の分布",
    short: "喫茶・食",
    description: "喫茶・カフェと飲食店の建物を強調し、本の街を支える滞在場所を読みます。",
  },
  alleys: {
    label: "路地と抜け道",
    short: "路地",
    description: "歩行者道、細街路、サービス道路、階段を強調し、街区内部の動線を読みます。",
  },
};

export const useLegend = [
  ["antiquarian_bookstore", "古書店", "#a6533c"],
  ["bookstore", "新刊・専門書店", "#d98a4e"],
  ["cafe", "喫茶・カフェ", "#4f7f78"],
  ["restaurant", "飲食店", "#7f6b9f"],
  ["retail", "物販・サービス", "#7389a6"],
  ["culture", "文化・学び", "#b29a45"],
  ["unclassified", "未分類", "#d9d4c8"],
] as const;

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
