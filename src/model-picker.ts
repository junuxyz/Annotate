export type ModelPricing = 'free' | 'paid' | 'unknown';

export function fillModelOptions({
  select,
  labels,
  pricing,
}: {
  select: HTMLSelectElement;
  labels: Record<string, string>;
  pricing: Record<string, ModelPricing>;
}): void {
  const doc = select.ownerDocument;
  const option = (value: string, label: string) => {
    const item = doc.createElement('option');
    item.value = value;
    item.textContent = label;
    return item;
  };
  select.replaceChildren();
  if (labels[''] !== undefined) select.append(option('', labels['']));
  for (const [price, label] of Object.entries({
    free: 'Free',
    paid: 'Paid',
    unknown: 'Price unavailable',
  })) {
    const entries = Object.entries(labels).filter(
      ([id]) => id && (pricing[id] ?? 'unknown') === price,
    );
    if (!entries.length) continue;
    const group = doc.createElement('optgroup');
    group.label = label;
    for (const [id, name] of entries) group.append(option(id, name));
    select.append(group);
  }
}

export const featuredOpenCodeModels: Record<string, string> = {
  'opencode/deepseek-v4.1-flash-free': 'DeepSeek V4.1 Flash Free',
  'opencode/glm-5.3-flash-free': 'GLM 5.3 Flash Free',
};

export function featuredModelLabels(
  labels: Record<string, string>,
  selected: string,
): Record<string, string> {
  const featured: Record<string, string> = {};
  for (const [id, label] of Object.entries(featuredOpenCodeModels))
    if (labels[id]) featured[id] = label;
  if (selected && labels[selected] && !featured[selected]) featured[selected] = labels[selected];
  if (!Object.keys(featured).length)
    featured[''] = Object.keys(labels).length ? 'Choose a model in Others' : 'Check to load models';
  return featured;
}

export function createOtherModelPicker({
  container,
  labels,
  pricing,
  onChoose,
}: {
  container: HTMLElement;
  labels: () => Record<string, string>;
  pricing: () => Record<string, ModelPricing>;
  onChoose: (id: string) => void;
}): { refresh: () => void; focus: () => void } {
  const doc = container.ownerDocument;
  const search = doc.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search all models';
  search.setAttribute('aria-label', 'Search all OpenCode models');
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Other OpenCode models');
  container.append(search, select);
  const refresh = () => {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matching = Object.fromEntries(
      Object.entries(labels()).filter(
        ([id, label]) => id && terms.every((term) => `${id} ${label}`.toLowerCase().includes(term)),
      ),
    );
    fillModelOptions({
      select,
      labels: {
        '': Object.keys(matching).length ? 'Choose a model' : 'No matching models',
        ...matching,
      },
      pricing: pricing(),
    });
  };
  search.addEventListener('input', refresh);
  select.addEventListener('change', () => {
    if (select.value && labels()[select.value]) onChoose(select.value);
  });
  refresh();
  return { refresh, focus: () => search.focus() };
}
