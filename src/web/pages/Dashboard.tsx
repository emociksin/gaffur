import { useMemo, useState } from 'react';
import type { Category, Product, Summary } from '../../shared/types';
import { changePct, money, pctFmt, timeAgo } from '../format';
import { IconBox, IconPlus, IconSearch, IconRefresh, Spinner, useToast } from '../ui';
import { ProductCard } from '../components/ProductCard';
import { api } from '../api';

type Sort = 'new' | 'drop' | 'price_asc' | 'price_desc' | 'name';

export function Dashboard({
  products,
  cats,
  summary,
  onOpenDetail,
  onAdd,
  refresh,
}: {
  products: Product[] | null;
  cats: Category[];
  summary: Summary | null;
  onOpenDetail: (id: number) => void;
  onAdd: () => void;
  refresh: () => Promise<void>;
}) {
  const toast = useToast();
  const [catFilter, setCatFilter] = useState<number | 'all' | 'none'>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [refreshingCat, setRefreshingCat] = useState<number | null>(null);

  const filtered = useMemo(() => {
    if (!products) return [];
    let list = products;
    if (catFilter === 'none') list = list.filter((p) => p.category_id == null);
    else if (catFilter !== 'all') list = list.filter((p) => p.category_id === catFilter);
    if (q.trim()) {
      const needle = q.trim().toLocaleLowerCase('tr');
      list = list.filter((p) => p.title.toLocaleLowerCase('tr').includes(needle));
    }
    const arr = [...list];
    switch (sort) {
      case 'drop':
        arr.sort((a, b) => (changePct(a) ?? 0) - (changePct(b) ?? 0));
        break;
      case 'price_asc':
        arr.sort((a, b) => (a.current_price ?? Infinity) - (b.current_price ?? Infinity));
        break;
      case 'price_desc':
        arr.sort((a, b) => (b.current_price ?? -1) - (a.current_price ?? -1));
        break;
      case 'name':
        arr.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
        break;
      default:
        arr.sort((a, b) => b.created_at - a.created_at);
    }
    return arr;
  }, [products, catFilter, q, sort]);

  const activeCat = catFilter !== 'all' && catFilter !== 'none' ? cats.find((c) => c.id === catFilter) : null;

  const refreshCat = async (id: number) => {
    setRefreshingCat(id);
    try {
      const r = await api.refreshCategory(id);
      if (r.refresh.ok) {
        toast(`Liste yenilendi: ${r.refresh.updated} fiyat güncellendi, ${r.refresh.added} yeni ürün`, 'ok');
      } else {
        toast(r.refresh.error ?? 'Liste yenilenemedi', 'err');
      }
      await refresh();
    } catch (e: any) {
      toast(e?.message ?? 'Liste yenilenemedi', 'err');
    } finally {
      setRefreshingCat(null);
    }
  };

  return (
    <div className="dash">
      {summary && (
        <section className="stats">
          <div className="stat">
            <span className="stat-n">{summary.active}</span>
            <span className="stat-l">takipteki ürün</span>
          </div>
          <div className="stat">
            <span className="stat-n stat-green">{summary.drops7d}</span>
            <span className="stat-l">7 günde düşüş</span>
          </div>
          <div className="stat">
            <span className={`stat-n ${summary.errors ? 'stat-red' : ''}`}>{summary.errors}</span>
            <span className="stat-l">sorunlu ürün</span>
          </div>
          <div className="stat">
            <span className="stat-n stat-dim">{timeAgo(summary.lastCheckAt)}</span>
            <span className="stat-l">son kontrol</span>
          </div>
        </section>
      )}

      {summary && summary.topDrops.length > 0 && (
        <section className="topdrops">
          <h3>Son 7 günün fırsatları</h3>
          <div className="topdrops-row">
            {summary.topDrops.map((d) => (
              <button key={d.id} className="topdrop" onClick={() => onOpenDetail(d.id)}>
                <span className="topdrop-pct">▼ {pctFmt(d.pct)}</span>
                <span className="topdrop-title">{d.title}</span>
                <span className="topdrop-price">
                  <s>{money(d.from_price, d.currency)}</s> {money(d.current_price, d.currency)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="filterbar">
        <div className="chips">
          <button className={`chip ${catFilter === 'all' ? 'on' : ''}`} onClick={() => setCatFilter('all')}>
            Tümü {products ? `(${products.length})` : ''}
          </button>
          {cats.map((c) => (
            <button
              key={c.id}
              className={`chip ${catFilter === c.id ? 'on' : ''}`}
              style={{ ['--chip' as any]: c.color }}
              onClick={() => setCatFilter(c.id)}
            >
              <span className="chip-dot" />
              {c.name} ({c.product_count ?? 0})
            </button>
          ))}
          {products && products.some((p) => p.category_id == null) && cats.length > 0 && (
            <button className={`chip ${catFilter === 'none' ? 'on' : ''}`} onClick={() => setCatFilter('none')}>
              Kategorisiz
            </button>
          )}
        </div>
        <div className="filter-right">
          <label className="search">
            <IconSearch size={15} />
            <input placeholder="Ürün ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sıralama">
            <option value="new">Son eklenen</option>
            <option value="drop">En çok düşen</option>
            <option value="price_asc">Fiyat (artan)</option>
            <option value="price_desc">Fiyat (azalan)</option>
            <option value="name">Ada göre</option>
          </select>
        </div>
      </section>

      {activeCat?.source_url && (
        <div className="cat-source">
          <span>
            Bu kategori bir Trendyol listesine bağlı — yeni ürünler otomatik keşfedilir (6 saatte bir).
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => refreshCat(activeCat.id)} disabled={refreshingCat === activeCat.id}>
            {refreshingCat === activeCat.id ? <Spinner size={13} /> : <IconRefresh size={14} />}
            Listeyi şimdi yenile
          </button>
        </div>
      )}

      {products == null ? (
        <div className="loading-block">
          <Spinner size={22} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <IconBox size={44} />
          {products.length === 0 ? (
            <>
              <h2>Henüz ürün takip etmiyorsun</h2>
              <p>
                Trendyol, Hepsiburada, Amazon veya N11'den bir ürün bağlantısı yapıştır — Gaffur fiyatı düzenli kontrol
                edip düşünce haber versin.
              </p>
              <button className="btn btn-primary" onClick={onAdd}>
                <IconPlus size={16} /> İlk ürünü ekle
              </button>
            </>
          ) : (
            <>
              <h2>Sonuç yok</h2>
              <p>Bu filtrelerle eşleşen ürün bulunamadı.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid">
          {filtered.map((p) => (
            <ProductCard key={p.id} p={p} cat={cats.find((c) => c.id === p.category_id)} onOpen={() => onOpenDetail(p.id)} refresh={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
