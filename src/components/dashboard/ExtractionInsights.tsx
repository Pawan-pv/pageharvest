import React from 'react';
import { Layers, Database, ShieldCheck, Zap } from 'lucide-react';
import { Card } from '@/components/common/Card';

export const ExtractionInsights: React.FC = () => {
  return (
    <Card variant="flat" className="text-left bg-slate-50/80 border-slate-200/70 p-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Zap className="w-3.5 h-3.5 text-amber-600" />
        <h4 className="text-xs font-semibold text-slate-800">
          What can be extracted?
        </h4>
      </div>
      <p className="text-[11px] text-slate-600 leading-relaxed">
        PageHarvest identifies repeating structures automatically:
      </p>

      <div className="grid grid-cols-2 gap-2 mt-2.5">
        <div className="flex items-start gap-1.5">
          <Layers className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-[11px] text-slate-700 leading-tight">
            <strong className="font-semibold block text-slate-900">Listings & Cards</strong>
            E-commerce, catalogs, search results
          </div>
        </div>

        <div className="flex items-start gap-1.5">
          <Database className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
          <div className="text-[11px] text-slate-700 leading-tight">
            <strong className="font-semibold block text-slate-900">Fields & Media</strong>
            Prices, links, tags, images, ratings
          </div>
        </div>
      </div>

      <div className="mt-3 pt-2.5 border-t border-slate-200/60 flex items-center gap-1.5 text-[10px] text-slate-500">
        <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span>100% local processing. No remote servers or APIs called.</span>
      </div>
    </Card>
  );
};
