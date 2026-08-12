type AnnotationStatus = "active" | "default" | null;

interface ListItem {
  noun: string;
  label: string;
  id: string;
  status: AnnotationStatus;
}

export function serializeList(input: {
  context: Record<string, string>;
  items: ListItem[];
}) {
  return {
    context: input.context,
    items: input.items.map((item) => ({
      name: item.label,
      id: item.id,
      status: item.status,
    })),
    count: input.items.length,
  };
}
