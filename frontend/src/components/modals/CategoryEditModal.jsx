import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { Field } from "../atoms";
import { CatIcon, ICON_MAP } from "../icons";
import { API } from "../../lib/api";

export function CategoryEditModal({ cat, groups, onClose, onSaved }) {
  const isNew = !cat;
  const [f, setF] = useState(cat || { name: "", group: groups[0] || "General", icon: "package", color: "#4F46E5", description: "", active: true });
  const iconOptions = Object.keys(ICON_MAP);
  const colorPresets = ["#4F46E5","#EC4899","#0EA5E9","#10B981","#F59E0B","#8B5CF6","#EF4444","#0891B2","#14B8A6","#F97316","#65A30D","#DC2626","#6B7280"];

  const save = async () => {
    try {
      if (isNew) await axios.post(`${API}/categories`, { name: f.name, group: f.group, icon: f.icon, color: f.color, description: f.description, active: !!f.active });
      else await axios.patch(`${API}/categories/${cat.id}`, { name: f.name, group: f.group, icon: f.icon, color: f.color, description: f.description, active: !!f.active });
      toast.success(isNew ? "Category created" : "Saved"); onSaved();
    } catch (e) { toast.error("Failed", { description: e?.response?.data?.detail }); }
  };

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md overflow-y-auto" onClick={onClose}>
      <motion.div initial={{opacity:0, y:20}} animate={{opacity:1, y:0}} exit={{opacity:0, y:20}} onClick={(e)=>e.stopPropagation()} className="card max-w-lg mx-auto my-10 p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="font-display font-bold text-xl">{isNew ? "New category" : "Edit category"}</div>
          <button onClick={onClose} className="btn btn-ghost !p-2"><X size={16}/></button>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-2xl grid place-items-center shrink-0" style={{ background: `${f.color}22`, color: f.color }}>
            <CatIcon name={f.icon} size={24}/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-bold truncate">{f.name || "Category name"}</div>
            <div className="text-[11px] font-mono text-slate-400">preview</div>
          </div>
        </div>
        <div className="grid gap-3">
          <Field label="Name"><input className="input px-3 py-2 w-full" value={f.name} onChange={(e)=>setF({...f, name:e.target.value})} data-testid="cat-name"/></Field>
          <Field label="Group">
            <input list="cat-groups" className="input px-3 py-2 w-full" value={f.group} onChange={(e)=>setF({...f, group:e.target.value})}/>
            <datalist id="cat-groups">{groups.map(g => <option key={g} value={g}/>)}</datalist>
          </Field>
          <Field label="Description"><textarea className="input px-3 py-2 w-full h-20" value={f.description||""} onChange={(e)=>setF({...f, description:e.target.value})}/></Field>
          <Field label="Icon">
            <div className="grid grid-cols-8 gap-1.5">
              {iconOptions.map(n => (
                <button key={n} onClick={()=>setF({...f, icon:n})} className={`aspect-square rounded-lg grid place-items-center border ${f.icon===n?"border-indigo-500 bg-indigo-50 text-indigo-600":"hairline text-slate-500 hover:bg-slate-50"}`} title={n}>
                  <CatIcon name={n} size={14}/>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Colour">
            <div className="flex items-center gap-2 flex-wrap">
              {colorPresets.map(c => (
                <button key={c} onClick={()=>setF({...f, color:c})} className={`w-7 h-7 rounded-full border-2 ${f.color===c?"border-slate-900":"border-white shadow"}`} style={{ background: c }} title={c}/>
              ))}
              <input type="color" value={f.color} onChange={(e)=>setF({...f, color:e.target.value})} className="w-9 h-9 rounded cursor-pointer"/>
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={save} className="btn btn-primary" data-testid="cat-save">{isNew ? "Create" : "Save"}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

