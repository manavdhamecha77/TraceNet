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
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Frame-Level Inspection</h1>
          <p className="text-gray-600 mt-2">
            Alert #{data.alert_id} • {data.camera_id} • {data.assault_type}
          </p>
        </div>

        {/* Alert Summary */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600">Peak Confidence</p>
              <p className="text-2xl font-bold text-blue-600">
                {(data.peak_confidence * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Assault Type</p>
              <p className="text-2xl font-bold text-gray-900">{data.assault_type}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Detected Frames</p>
              <p className="text-2xl font-bold text-green-600">
                {data.detected_frames.length}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Video Duration</p>
              <p className="text-2xl font-bold text-gray-900">
                {data.video_duration_seconds.toFixed(1)}s
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Timeline */}
          <div className="col-span-2">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4">Detection Timeline</h2>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {data.detected_frames.map((frame, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedFrame(frame)}
                    className={`p-4 rounded cursor-pointer transition ${
                      selectedFrame?.frame_number === frame.frame_number
                        ? "bg-blue-50 border-2 border-blue-500"
                        : "bg-gray-50 border border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">
                          Frame {frame.frame_number}
                        </p>
                        <p className="text-sm text-gray-600">
                          {frame.timestamp_seconds.toFixed(2)}s • {frame.assault_type}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-lg font-bold text-blue-600">
                            {(frame.confidence * 100).toFixed(1)}%
                          </p>
                          {frame.is_key_frame && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                              Key Frame
                            </span>
                          )}
                        </div>
                        <div className="w-24 h-2 bg-gray-200 rounded overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-yellow-400 to-red-500"
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Frame Details</h2>
            {selectedFrame ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Frame Number</p>
                  <p className="text-xl font-semibold">{selectedFrame.frame_number}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Timestamp</p>
                  <p className="text-xl font-semibold">
                    {selectedFrame.timestamp_seconds.toFixed(2)}s
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Assault Type</p>
                  <p className="text-xl font-semibold">{selectedFrame.assault_type}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Confidence Score</p>
                  <div className="mt-2">
                    <div className="w-full h-3 bg-gray-200 rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-yellow-400 to-red-500"
                        style={{ width: `${selectedFrame.confidence * 100}%` }}
                      />
                    </div>
                    <p className="text-lg font-bold mt-2 text-blue-600">
                      {(selectedFrame.confidence * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
                {selectedFrame.is_key_frame && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
                    <p className="text-sm text-red-700 font-semibold">
                      ⚠️ High confidence detection frame
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">Select a frame to view details</p>
            )}
          </div>
        </div>

        {/* Statistics */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-bold mb-4">Detection Statistics</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600">Frames Analyzed</p>
              <p className="text-2xl font-bold">{data.total_frames_analyzed}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Average Confidence</p>
              <p className="text-2xl font-bold">
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
            <div>
              <p className="text-sm text-gray-600">Key Frames (&gt;60%)</p>
              <p className="text-2xl font-bold">
                {data.detected_frames.filter((f) => f.is_key_frame).length}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
