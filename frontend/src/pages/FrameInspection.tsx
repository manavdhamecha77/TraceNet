import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";

interface FrameInfo {
  frame_number: number;
  timestamp_seconds: number;
  confidence: number;
  assault_type: string;
  is_key_frame: boolean;
}

interface FrameInspectionData {
  video_id: string;
  camera_id: string;
  alert_id: number;
  has_assault: boolean;
  assault_type: string;
  peak_confidence: number;
  detected_frames: FrameInfo[];
  total_frames_analyzed: number;
  video_duration_seconds: number;
  detection_timestamp: string;
}

const API_BASE = typeof window !== 'undefined' ? `http://${window.location.hostname}:8000` : 'http://localhost:8000';

export default function FrameInspection() {
  const { alertId } = useParams<{ alertId: string }>();
  const [data, setData] = useState<FrameInspectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<FrameInfo | null>(null);

  useEffect(() => {
    if (!alertId) return;

    const fetchFrameData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/v1/frame-inspection/alert/${alertId}`);
        if (!res.ok) {
          throw new Error("Failed to load frame data");
        }
        const jsonData = await res.json();
        setData(jsonData);
        if (jsonData.detected_frames && jsonData.detected_frames.length > 0) {
          setSelectedFrame(jsonData.detected_frames[0]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load frame data");
      } finally {
        setLoading(false);
      }
    };

    fetchFrameData();
  }, [alertId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-600">Loading frame analysis...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-red-600">{error || "No data available"}</div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="border-b border-slate-800 pb-4">
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <span>Frame-Level Inspection</span>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
              PHYSICAL ASSAULT ANALYTICS
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Alert #{data.alert_id} • Node {data.camera_id} • Event Type: <span className="text-rose-400 font-semibold">{data.assault_type}</span>
          </p>
        </div>

        {/* Alert Summary */}
        <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-400 uppercase font-mono">Peak Confidence</p>
              <p className="text-2xl font-black text-cyan-400 mt-0.5">
                {(data.peak_confidence * 100).toFixed(1)}%
              </p>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-400 uppercase font-mono">Assault Type</p>
              <p className="text-2xl font-black text-rose-400 mt-0.5">{data.assault_type}</p>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-400 uppercase font-mono">Detected Frames</p>
              <p className="text-2xl font-black text-emerald-400 mt-0.5">
                {data.detected_frames.length}
              </p>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-400 uppercase font-mono">Video Duration</p>
              <p className="text-2xl font-black text-slate-200 mt-0.5">
                {data.video_duration_seconds.toFixed(1)}s
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Timeline */}
          <div className="md:col-span-2">
            <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-100">Detection Timeline</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {data.detected_frames.map((frame, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedFrame(frame)}
                    className={`p-3 rounded-lg cursor-pointer transition-all border ${
                      selectedFrame?.frame_number === frame.frame_number
                        ? "bg-cyan-500/10 border-cyan-500 text-cyan-200"
                        : "bg-slate-950/80 border-slate-800 hover:border-slate-700 text-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-xs text-slate-200">
                          Frame {frame.frame_number}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {frame.timestamp_seconds.toFixed(2)}s • {frame.assault_type}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-bold text-cyan-400">
                            {(frame.confidence * 100).toFixed(1)}%
                          </p>
                          {frame.is_key_frame && (
                            <span className="text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded font-mono">
                              Key Frame
                            </span>
                          )}
                        </div>
                        <div className="w-24 h-2 bg-slate-800 rounded overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-400 to-rose-500"
                            style={{ width: `${frame.confidence * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Frame Details */}
          <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-100">Frame Details</h2>
            {selectedFrame ? (
              <div className="space-y-3 text-xs">
                <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                  <p className="text-slate-500 font-mono">Frame Number</p>
                  <p className="text-lg font-bold text-slate-200">{selectedFrame.frame_number}</p>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                  <p className="text-slate-500 font-mono">Timestamp</p>
                  <p className="text-lg font-bold text-slate-200">
                    {selectedFrame.timestamp_seconds.toFixed(2)}s
                  </p>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                  <p className="text-slate-500 font-mono">Assault Type</p>
                  <p className="text-lg font-bold text-rose-400">{selectedFrame.assault_type}</p>
                </div>
                <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                  <p className="text-slate-500 font-mono">Confidence Score</p>
                  <div className="mt-1 space-y-1">
                    <div className="w-full h-2.5 bg-slate-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 to-rose-500"
                        style={{ width: `${selectedFrame.confidence * 100}%` }}
                      />
                    </div>
                    <p className="text-base font-bold text-cyan-400">
                      {(selectedFrame.confidence * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
                {selectedFrame.is_key_frame && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-xs">
                    <p className="font-bold">⚠️ High Confidence Detection Frame</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-500 text-center py-8 text-xs">Select a frame to view details</p>
            )}
          </div>
        </div>

        {/* Statistics */}
        <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5">
          <h2 className="text-base font-bold text-slate-100 mb-3">Detection Statistics</h2>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-400 font-mono">Frames Analyzed</p>
              <p className="text-xl font-bold text-slate-200">{data.total_frames_analyzed}</p>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-400 font-mono">Average Confidence</p>
              <p className="text-xl font-bold text-cyan-400">
                {data.detected_frames.length > 0
                  ? (
                      (data.detected_frames.reduce((sum, f) => sum + f.confidence, 0) /
                        data.detected_frames.length) *
                      100
                    ).toFixed(1)
                  : "0"}
                %
              </p>
            </div>
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <p className="text-xs text-slate-400 font-mono">Key Frames (&gt;60%)</p>
              <p className="text-xl font-bold text-rose-400">
                {data.detected_frames.filter((f) => f.is_key_frame).length}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
