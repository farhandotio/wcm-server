import Slider from '../models/Slider.js';
import cloudinary from 'cloudinary';

// ১. সব স্লাইডার গেট করা (Public)
export const getSliders = async (req, res) => {
  try {
    const sliders = await Slider.find().sort({ createdAt: -1 });
    res.status(200).json(sliders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ২. নতুন স্লাইডার অ্যাড করা (Admin Only)
export const addSlider = async (req, res) => {
  try {
    const { title, subTitle, link, imageUrl, public_id } = req.body;

    const newSlider = new Slider({
      title,
      subTitle,
      link,
      imageUrl,
      public_id
    });

    await newSlider.save();
    res.status(201).json({ message: "Slider added successfully", newSlider });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ৩. স্লাইডার ডিলিট করা (Admin Only)
export const deleteSlider = async (req, res) => {
  try {
    const { id } = req.params;
    const slider = await Slider.findById(id);

    if (!slider) return res.status(404).json({ message: "Slider not found" });

    // ক্লাউডিনারি থেকেও ইমেজ ডিলিট করা (অপশনাল কিন্তু ভালো প্র্যাকটিস)
    await cloudinary.v2.uploader.destroy(slider.public_id);

    await Slider.findByIdAndDelete(id);
    res.status(200).json({ message: "Slider deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// ৪. স্লাইডার আপডেট করা (Admin Only)
export const updateSlider = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subTitle, link, imageUrl, public_id } = req.body;

    const updatedSlider = await Slider.findByIdAndUpdate(
      id,
      { title, subTitle, link, imageUrl, public_id },
      { new: true } // এটি আপডেট হওয়া নতুন ডাটাটি রিটার্ন করবে
    );

    if (!updatedSlider) return res.status(404).json({ message: "Slider not found" });

    res.status(200).json({ message: "Slider updated successfully", updatedSlider });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};