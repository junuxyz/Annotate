import { z } from 'zod';

export const maxImageBytes = 5 * 1024 * 1024;
const imageMime = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const imageAttachmentSchema = z.object({
  name: z.string().min(1).max(255),
  dataUrl: z
    .string()
    .max(Math.ceil(maxImageBytes / 3) * 4 + 64)
    .regex(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    .refine((value) => {
      const data = value.slice(value.indexOf(',') + 1);
      const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
      return data.length % 4 === 0 && (data.length * 3) / 4 - padding <= maxImageBytes;
    }),
});
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;

export async function readImage(file: File, doc: Document): Promise<ImageAttachment> {
  if (!imageMime.safeParse(file.type).success)
    throw new Error('Paste a PNG, JPEG, GIF, or WebP image.');
  if (!file.size || file.size > maxImageBytes)
    throw new Error('Each image must be smaller than 5 MB.');
  const Reader = doc.defaultView?.FileReader;
  if (!Reader) throw new Error('Image clipboard is unavailable.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Unable to read the pasted image.'));
    reader.onerror = () => reject(new Error('Unable to read the pasted image.'));
    reader.readAsDataURL(file);
  });
  return imageAttachmentSchema.parse({
    name: (file.name || 'Pasted image').slice(0, 255),
    dataUrl,
  });
}

export function imagePreview(doc: Document, images: ImageAttachment[]): HTMLElement {
  const list = doc.win.createDiv();
  list.className = 'annotate-images';
  for (const image of images) {
    const thumbnail = doc.win.createEl('img');
    thumbnail.src = image.dataUrl;
    thumbnail.alt = image.name;
    thumbnail.title = image.name;
    list.append(thumbnail);
  }
  return list;
}
