import { component$, useSignal, useComputed$, $ } from '@builder.io/qwik';
import { routeLoader$, routeAction$, z, zod$, Form } from '@builder.io/qwik-city';
import { createClient } from '@supabase/supabase-js';

// --- INTERFACES ---
interface Condition {
  id: number;
  code: string;
  description: string;
}

interface Comic {
  id: number;
  series: string;
  issue_number: string;
  value_2017: number;
  value: number;
  notes: string;
  added_date: string;
  condition_id: number;
  conditions: Condition | null;
  tags: string | null;
}

interface GroupedComic {
  key: string;
  series: string;
  issue_number: string;
  comics: Comic[];
  condition_codes: string[];
}

// --- HELPER: CONDITION COLORS ---
const getConditionColor = (code: string | undefined) => {
  if (!code) return 'bg-gray-800 text-gray-400 border-gray-700';
  const c = code.toUpperCase();
  if (c.includes('M')) return 'bg-emerald-950 text-emerald-200 border-emerald-600';
  if (c.includes('NM')) return 'bg-green-900 text-green-200 border-green-600';
  if (c === 'VF/NM') return 'bg-teal-900 text-teal-200 border-teal-600';
  if (c.includes('VF')) return 'bg-cyan-900 text-cyan-200 border-cyan-600';
  if (c.includes('F')) return 'bg-blue-900 text-blue-200 border-blue-600';
  if (c.includes('VG')) return 'bg-indigo-900 text-indigo-200 border-indigo-600';
  if (c.includes('G')) return 'bg-yellow-900 text-yellow-200 border-yellow-600';
  if (c.includes('FR')) return 'bg-orange-900 text-orange-200 border-orange-600';
  if (c.includes('P')) return 'bg-red-900 text-red-200 border-red-600';
  if (c === 'NC') return 'bg-slate-800 text-slate-400 border-slate-600';
  return 'bg-slate-800 text-slate-300 border-slate-600';
};

// --- HELPER: CLEAN TAGS ---
const sanitizeTags = (raw: string | undefined | null) => {
  if (!raw) return '';
  return raw.split(',').map(t => t.trim()).filter(t => t.length > 0).join(', ');
};

// --- HELPER: DELAY (Fixes refresh issue) ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- ACTIONS ---

export const useAddComic = routeAction$(async (data, requestEvent) => {
  const userID = requestEvent.env.get('PUBLIC_USER_ID');
  const url = requestEvent.env.get('PUBLIC_SUPABASE_URL');
  const key = requestEvent.env.get('PUBLIC_SUPABASE_ANON_KEY');
  if (!userID || !url || !key) return { success: false, message: 'Missing API Keys' };

  const supabase = createClient(url, key);

  const condId = parseInt(data.condition_id as string);
  const val2017 = parseFloat(data.value_2017 as string);
  const valCur = parseFloat(data.value as string);
  const cleanTags = sanitizeTags(data.tags as string);

  const { error } = await supabase.from('comics').insert({
    user_id: userID,
    series: data.series,
    issue_number: data.issue_number,
    condition_id: isNaN(condId) ? 1 : condId,
    value_2017: isNaN(val2017) ? 0 : val2017,
    value: isNaN(valCur) ? 0 : valCur,
    notes: data.notes || '',
    tags: cleanTags
  });

  if (error) return { success: false, message: error.message };
  
  // WAIT 500ms for DB to sync
  await delay(500); 
  
  return { success: true };
}, zod$({
  series: z.string().min(1),
  issue_number: z.string().min(1),
  condition_id: z.string(),
  value_2017: z.string().optional(),
  value: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional()
}));

export const useEditComic = routeAction$(async (data, requestEvent) => {
  const url = requestEvent.env.get('PUBLIC_SUPABASE_URL');
  const key = requestEvent.env.get('PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key) return { success: false };

  const supabase = createClient(url, key);
  
  const condId = parseInt(data.condition_id as string);
  const valCur = parseFloat(data.value as string);
  const cleanTags = sanitizeTags(data.tags as string);

  const { error } = await supabase.from('comics').update({
    series: data.series,
    issue_number: data.issue_number,
    condition_id: isNaN(condId) ? 1 : condId,
    value: isNaN(valCur) ? 0 : valCur,
    notes: data.notes || '',
    tags: cleanTags
  }).eq('id', data.id);

  if (error) return { success: false, message: error.message };
  
  // WAIT 500ms for DB to sync
  await delay(500);

  return { success: true };
}, zod$({
  id: z.string(),
  series: z.string().min(1),
  issue_number: z.string().min(1),
  condition_id: z.string(),
  value: z.string().optional(),
  notes: z.string().optional(),
  tags: z.string().optional()
}));

export const useDeleteComic = routeAction$(async (data, requestEvent) => {
  const url = requestEvent.env.get('PUBLIC_SUPABASE_URL');
  const key = requestEvent.env.get('PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key) return { success: false };

  const supabase = createClient(url, key);
  const { error } = await supabase.from('comics').delete().eq('id', data.id);
  if (error) return { success: false, message: error.message };
  
  await delay(500); // Wait for sync
  
  return { success: true };
}, zod$({ id: z.string() }));

// --- LOADER ---
export const useComicsData = routeLoader$(async (requestEvent) => {
  // STRICT CACHE BUSTING
  requestEvent.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  
  const userID = requestEvent.env.get('PUBLIC_USER_ID');
  const url = requestEvent.env.get('PUBLIC_SUPABASE_URL');
  const key = requestEvent.env.get('PUBLIC_SUPABASE_ANON_KEY');
  if (!userID || !url || !key) return { comics: [], conditions: [] };

  const supabase = createClient(url, key);
  
  const comicsReq = await supabase
    .from('comics')
    .select(`*, conditions ( id, code, description )`)
    .eq('user_id', userID);

  const conditionsReq = await supabase
    .from('conditions')
    .select('*')
    .order('id', { ascending: true });

  return {
    comics: (comicsReq.data as any[]) || [],
    conditions: (conditionsReq.data as any[]) || []
  };
});

// --- COMPONENT ---
export default component$(() => {
  const data = useComicsData();
  const addAction = useAddComic();
  const editAction = useEditComic();
  const deleteAction = useDeleteComic();
  
  const showAddForm = useSignal(false);
  const searchQuery = useSignal('');
  const filterConditionId = useSignal<string>('ALL');
  const filterTag = useSignal<string>('ALL');

  const selectedGroupKey = useSignal<string | null>(null);
  const editingId = useSignal<number | null>(null);

  const groupedList = useComputed$(() => {
    const rawComics = data.value.comics;
    
    // Rank Maps
    const conditionRankMap: Record<string, number> = {};
    const conditionIdRankMap: Record<number, number> = {};
    data.value.conditions.forEach((c, index) => {
      conditionRankMap[c.code] = index;
      conditionIdRankMap[c.id] = index;
    });

    // Filter
    const filtered = rawComics.filter((c) => {
      const s = searchQuery.value.toLowerCase();
      const matchesSearch = c.series.toLowerCase().includes(s) || c.issue_number.includes(s);
      
      const matchesCondition = filterConditionId.value === 'ALL' || 
                               c.conditions?.id.toString() === filterConditionId.value;
      
      let matchesTag = true;
      if (filterTag.value !== 'ALL') {
         if (!c.tags) return false;
         const tagsArray = c.tags.split(',').map(t => t.trim().toLowerCase());
         matchesTag = tagsArray.includes(filterTag.value.toLowerCase());
      }

      return matchesSearch && matchesCondition && matchesTag;
    });

    // Group
    const groups: Record<string, GroupedComic> = {};
    filtered.forEach((comic) => {
      const key = `${comic.series}|${comic.issue_number}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          series: comic.series,
          issue_number: comic.issue_number,
          comics: [],
          condition_codes: []
        };
      }
      groups[key].comics.push(comic);
      if (comic.conditions?.code && !groups[key].condition_codes.includes(comic.conditions.code)) {
        groups[key].condition_codes.push(comic.conditions.code);
      }
    });

    const groupsArray = Object.values(groups);

    // Sort Groups
    groupsArray.sort((a, b) => {
      const seriesDiff = a.series.localeCompare(b.series);
      if (seriesDiff !== 0) return seriesDiff;
      return a.issue_number.localeCompare(b.issue_number, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Sort Items
    groupsArray.forEach(group => {
      group.comics.sort((a, b) => {
        const rankA = conditionIdRankMap[a.condition_id] ?? 999;
        const rankB = conditionIdRankMap[b.condition_id] ?? 999;
        if (rankA !== rankB) return rankA - rankB; 
        return (b.value || 0) - (a.value || 0); 
      });

      group.condition_codes.sort((a, b) => {
        const rankA = conditionRankMap[a] ?? 999;
        const rankB = conditionRankMap[b] ?? 999;
        return rankA - rankB;
      });
    });

    return groupsArray;
  });

  const availableTags = useComputed$(() => {
    const allTags = new Set<string>();
    data.value.comics.forEach(c => {
      if (c.tags) {
        c.tags.split(',').forEach(t => {
            const trimmed = t.trim();
            if(trimmed) allTags.add(trimmed);
        });
      }
    });
    return Array.from(allTags).sort();
  });

  const activeGroup = selectedGroupKey.value 
    ? groupedList.value.find(g => g.key === selectedGroupKey.value) 
    : null;

  return (
    <div class="min-h-screen w-full bg-slate-950 text-slate-200 font-sans">
      <div class="max-w-4xl mx-auto p-4 sm:p-6 pb-24">

        {/* HEADER */}
        <div class="mb-6 bg-slate-900 p-6 rounded-xl shadow-lg border border-slate-800">
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">My Collection</h1>
            <button 
              onClick$={() => showAddForm.value = !showAddForm.value}
              class="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center gap-2 text-sm shadow-md"
            >
              {showAddForm.value ? 'Cancel' : '+ Add'}
            </button>
          </div>

          {/* ADD FORM */}
          {showAddForm.value && (
            <div class="mb-8 bg-slate-800/50 p-4 sm:p-6 rounded-lg border border-slate-700 animate-fadeIn">
              <h2 class="text-lg font-bold text-blue-300 mb-4">Add New Issue</h2>
              
              {addAction.value?.failed && (
                <div class="mb-4 p-3 bg-red-900/50 border border-red-700 text-red-200 text-sm rounded">
                  Error: {addAction.value.message}
                </div>
              )}

              <Form action={addAction} class="space-y-4" onSubmitCompleted$={() => {
                if (addAction.value?.success) showAddForm.value = false;
              }}>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Series</label>
                    <input name="series" type="text" placeholder="e.g. Batman" class="w-full p-2.5 bg-slate-800 border border-slate-600 rounded text-white focus:border-blue-500 outline-none" required />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Issue #</label>
                    <input name="issue_number" type="text" placeholder="e.g. 100" class="w-full p-2.5 bg-slate-800 border border-slate-600 rounded text-white focus:border-blue-500 outline-none" required />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Condition</label>
                    <select name="condition_id" class="w-full p-2.5 bg-slate-800 border border-slate-600 rounded text-white focus:border-blue-500 outline-none">
                      {data.value.conditions.map(c => (
                        <option key={c.id} value={c.id}>{c.description} ({c.code})</option>
                      ))}
                    </select>
                  </div>
                  <div class="flex gap-2">
                    <div class="flex-1">
                      <label class="block text-xs font-bold text-slate-400 uppercase mb-1">2017 Value</label>
                      <input name="value_2017" type="number" step="0.01" placeholder="0.00" class="w-full p-2.5 bg-slate-800 border border-slate-600 rounded text-white focus:border-blue-500 outline-none" />
                    </div>
                    <div class="flex-1">
                      <label class="block text-xs font-bold text-green-400 uppercase mb-1">Cur. Value</label>
                      <input name="value" type="number" step="0.01" placeholder="0.00" class="w-full p-2.5 bg-slate-800 border border-slate-600 rounded text-white focus:border-blue-500 outline-none" />
                    </div>
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-bold text-purple-400 uppercase mb-1">Tags</label>
                  <input name="tags" type="text" placeholder="Key, Signed, Variant..." class="w-full p-2.5 bg-slate-800 border border-slate-600 rounded text-white focus:border-purple-500 outline-none" />
                  <p class="text-[10px] text-slate-500 mt-1">Separate tags with commas</p>
                </div>

                <div>
                  <label class="block text-xs font-bold text-slate-400 uppercase mb-1">Notes</label>
                  <textarea name="notes" rows={2} class="w-full p-2.5 bg-slate-800 border border-slate-600 rounded text-white focus:border-blue-500 outline-none"></textarea>
                </div>
                <div class="flex justify-end gap-3 items-center">
                  {addAction.isRunning && <span class="text-blue-300 text-sm animate-pulse">Saving...</span>}
                  <button type="submit" disabled={addAction.isRunning} class="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-2 px-6 rounded shadow-md transition-colors w-full sm:w-auto">
                    Save
                  </button>
                </div>
              </Form>
            </div>
          )}
          
          {/* FILTERS */}
          <div class="flex flex-col sm:flex-row gap-4 pt-4 border-t border-slate-800">
            <div class="flex-grow">
              <input 
                type="text" 
                placeholder="Search..." 
                class="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-blue-600 outline-none placeholder-slate-500"
                onInput$={(e) => searchQuery.value = (e.target as HTMLInputElement).value}
              />
            </div>
            
            <div class="w-full sm:w-40">
              <select 
                class="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-blue-600 outline-none"
                onInput$={(e) => filterConditionId.value = (e.target as HTMLSelectElement).value}
              >
                <option value="ALL">All Conditions</option>
                {data.value.conditions.map(c => (
                  <option key={c.id} value={c.id}>{c.description}</option>
                ))}
              </select>
            </div>

            <div class="w-full sm:w-40">
              <select 
                class="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white focus:ring-2 focus:ring-purple-600 outline-none"
                onInput$={(e) => filterTag.value = (e.target as HTMLSelectElement).value}
              >
                <option value="ALL">All Tags</option>
                {availableTags.value.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* LIST */}
        <div class="space-y-3">
          {groupedList.value.length === 0 && (
            <div class="text-center p-12 text-slate-500 bg-slate-900 rounded-xl border border-dashed border-slate-800">
              No comics found.
            </div>
          )}

          {groupedList.value.map((group) => (
            <div 
              key={group.key} 
              onClick$={() => selectedGroupKey.value = group.key} 
              class="bg-slate-900 border border-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-800/80 hover:border-slate-700 transition-all shadow-sm active:scale-[0.99]"
            >
              <div class="flex items-center justify-between gap-4">
                <div class="flex items-center gap-4 min-w-0">
                  <div class="bg-slate-700 text-white font-bold px-3 py-1.5 rounded-lg text-lg min-w-[3.5rem] text-center shadow-md border border-slate-600">
                    #{group.issue_number}
                  </div>
                  <h3 class="text-lg font-bold text-slate-100 truncate">{group.series}</h3>
                </div>

                <div class="flex items-center gap-3 overflow-hidden">
                  <div class="hidden sm:flex gap-1 flex-nowrap overflow-hidden">
                    {group.condition_codes.slice(0, 10).map((code, i) => (
                      <span key={`${code}-${i}`} class={`text-[10px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${getConditionColor(code)}`}>
                        {code}
                      </span>
                    ))}
                    {group.condition_codes.length > 10 && <span class="text-xs text-slate-500">...</span>}
                  </div>
                  <div class="bg-slate-800 text-slate-400 text-xs font-bold px-2 py-1 rounded-full border border-slate-700 shrink-0">
                    {group.comics.length}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- MODAL OVERLAY --- */}
      {activeGroup && (
        <div 
          onClick$={() => { selectedGroupKey.value = null; editingId.value = null; }}
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
        >
          <div 
             onClick$={(e) => e.stopPropagation()}
             class="bg-slate-900 w-full max-w-xl max-h-[85vh] rounded-2xl shadow-2xl border border-slate-700 flex flex-col overflow-hidden animate-scaleIn"
          >
            <div class="p-4 sm:p-6 overflow-y-auto custom-scrollbar space-y-4">
              
              {activeGroup.comics.map((comic) => (
                <div key={comic.id} class="bg-slate-950/50 border border-slate-800 rounded-xl p-4 transition-all">
                  
                  {/* --- EDIT MODE --- */}
                  {editingId.value === comic.id ? (
                    <Form action={editAction} onSubmitCompleted$={() => editingId.value = null} class="flex flex-col gap-4">
                      <input type="hidden" name="id" value={comic.id} />
                      
                      <div class="grid grid-cols-2 gap-4">
                        <div>
                           <label class="block text-[10px] text-slate-500 uppercase mb-1">Series Name</label>
                           <input name="series" value={comic.series} class="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:border-blue-500 outline-none" />
                        </div>
                        <div>
                           <label class="block text-[10px] text-slate-500 uppercase mb-1">Issue #</label>
                           <input name="issue_number" value={comic.issue_number} class="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:border-blue-500 outline-none" />
                        </div>
                      </div>

                      <div class="grid grid-cols-3 gap-3">
                        <div class="col-span-1">
                          <label class="block text-[10px] text-slate-500 uppercase mb-1">Condition</label>
                          <select name="condition_id" class="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:border-blue-500 outline-none">
                            {data.value.conditions.map(c => (
                              <option key={c.id} value={c.id} selected={c.id === comic.condition_id}>{c.description}</option>
                            ))}
                          </select>
                        </div>
                        <div class="col-span-1 opacity-60">
                          <label class="block text-[10px] text-slate-500 uppercase mb-1">2017 (Fixed)</label>
                          <div class="w-full p-2 bg-slate-800 border border-slate-700 rounded text-slate-400 text-sm cursor-not-allowed">
                             ${comic.value_2017?.toFixed(2)}
                          </div>
                        </div>
                        <div class="col-span-1">
                          <label class="block text-[10px] text-green-500 uppercase mb-1">Cur. Value</label>
                          <input name="value" type="number" step="0.01" value={comic.value} class="w-full p-2 bg-slate-900 border border-green-700 rounded text-white text-sm focus:border-green-500 outline-none" />
                        </div>
                      </div>
                      
                      <div>
                         <label class="block text-[10px] text-purple-400 uppercase mb-1">Tags</label>
                         <input name="tags" type="text" value={comic.tags || ''} class="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:border-purple-500 outline-none" />
                      </div>

                      <div>
                        <label class="block text-[10px] text-slate-500 uppercase mb-1">Notes</label>
                        <textarea name="notes" rows={2} class="w-full p-2 bg-slate-900 border border-slate-600 rounded text-white text-sm focus:border-blue-500 outline-none">{comic.notes}</textarea>
                      </div>

                      <div class="flex gap-3 pt-2 items-center">
                        {editAction.isRunning && <span class="text-blue-300 text-xs animate-pulse">Saving...</span>}
                        <button type="submit" disabled={editAction.isRunning} class="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-bold shadow-sm">Save</button>
                        <button type="button" onClick$={() => editingId.value = null} class="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm">Cancel</button>
                      </div>
                    </Form>
                  ) : (
                    /* --- VIEW MODE --- */
                    <div 
                      class="flex flex-col gap-2 cursor-pointer group"
                      onClick$={() => editingId.value = comic.id}
                    >
                      <div class="flex justify-between items-start">
                        <div>
                          <h3 class="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                            {comic.series} <span class="text-slate-500">#</span>{comic.issue_number}
                          </h3>
                        </div>
                        
                        <Form action={deleteAction} class="shrink-0" onClick$={(e) => e.stopPropagation()}>
                          <input type="hidden" name="id" value={comic.id} />
                          <button 
                            type="submit" 
                            class="p-2 text-slate-600 hover:text-red-400 transition-colors"
                            onClick$={() => { if(!confirm('Delete this copy?')) return false; }}
                          >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                          </button>
                        </Form>
                      </div>

                      <div class="flex flex-wrap items-center gap-4">
                        <span class={`text-xs font-bold px-2 py-1 rounded border ${getConditionColor(comic.conditions?.code)}`}>
                          {comic.conditions?.description} ({comic.conditions?.code})
                        </span>
                        
                        <div class="flex items-center gap-4">
                          <div class="flex flex-col items-center">
                            <span class="text-[10px] text-slate-500 uppercase font-bold tracking-wide">2017</span>
                            <span class="text-slate-400 font-mono text-sm">${comic.value_2017?.toFixed(2)}</span>
                          </div>
                          <div class="flex flex-col items-center">
                            <span class="text-[10px] text-emerald-500 uppercase font-bold tracking-wide">Current</span>
                            <span class="text-emerald-400 font-mono text-sm font-bold">${comic.value?.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {comic.tags && comic.tags.trim().length > 0 && (
                        <div class="flex flex-wrap gap-2 mt-2">
                          {comic.tags.split(',').filter(t => t.trim().length > 0).map(tag => (
                            <span key={tag} class="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full">
                              #{tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}

                      {comic.notes && (
                        <p class="text-slate-400 text-sm italic mt-1">"{comic.notes}"</p>
                      )}
                      
                      <div class="text-[10px] text-slate-600 uppercase mt-1 flex items-center gap-2">
                         <span>Click to edit</span>
                         <span class="w-1 h-1 bg-slate-700 rounded-full"></span>
                         <span>Added {new Date(comic.added_date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              <div class="text-center text-xs text-slate-600 italic pt-4">
                Click any row to edit details. Click background to close.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});