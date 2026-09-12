'use client';

import { Link2, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { ProviderDefinition } from '@/lib/providers';
import { Sheet } from '../shared/sheet';

export function ProductPicker({
  provider,
  products,
  connected,
  onClose,
  onConnect,
}: {
  provider: ProviderDefinition;
  products: { name: string; url: string }[];
  connected: string[];
  onClose: () => void;
  onConnect: (serverUrls: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState(() =>
    products.map((product) => product.url).filter((url) => !connected.includes(url)),
  );
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title={`Connect ${provider.name}`}
      subtitle="Choose the products to connect, then sign in once."
      onClose={onClose}
      footer={
        <button
          className="primary-button full"
          type="submit"
          form="product-picker-form"
          disabled={busy || selected.length === 0}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}
          {busy ? 'Opening sign-in' : `Sign in with ${provider.name.split(' ')[0]}`}
        </button>
      }
    >
      <form
        id="product-picker-form"
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          await onConnect(selected);
          setBusy(false);
        }}
      >
        <div className="tool-checklist">
          {products.map((product) => {
            const already = connected.includes(product.url);
            const checked = already || selected.includes(product.url);
            return (
              <label key={product.url}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={already}
                  onChange={() =>
                    setSelected(
                      checked ? selected.filter((url) => url !== product.url) : [...selected, product.url],
                    )
                  }
                />
                <span>
                  <strong>{product.name}</strong>
                  {already && <small>Already connected</small>}
                </span>
              </label>
            );
          })}
        </div>
        <p className="form-note">{provider.note}</p>
      </form>
    </Sheet>
  );
}
