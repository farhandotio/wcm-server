import {
  enableLanguage, listLanguages, publishLanguage, reconcileLanguageBackfill,
  registerLanguage, retryLanguageBackfill, setLanguageAvailability,
} from '../services/translation/languageConfigurationService.js';

const sendError = (res, error) => res.status(['UNREGISTERED_LANGUAGE', 'TARGET_LANGUAGE_DISABLED'].includes(error.code) ? 404 : error.code === 'LANGUAGE_NOT_READY' ? 409 : 400).json({ success: false, code: error.code, message: error.message });
export const getPublishedLanguages = async (_req, res) => {
  const languages = await listLanguages({ publishedOnly: true });
  res.json({ success: true, data: languages.map(({ code, name, nativeName, direction, isSource, catalogVersion }) => ({ code, name, nativeName, direction, isSource, catalogVersion })) });
};
export const getLanguages = async (_req, res) => res.json({ success: true, data: await listLanguages() });
export const createLanguage = async (req, res) => { try { res.status(201).json({ success: true, data: await registerLanguage(req.body, req.user._id) }); } catch (error) { sendError(res, error); } };
export const enableLanguageConfiguration = async (req, res) => { try { res.status(202).json({ success: true, data: await enableLanguage(req.params.code, req.user._id) }); } catch (error) { sendError(res, error); } };
export const getLanguageBackfill = async (req, res) => { try { res.json({ success: true, data: await reconcileLanguageBackfill(req.params.code) }); } catch (error) { sendError(res, error); } };
export const retryLanguageConfiguration = async (req, res) => { try { res.status(202).json({ success: true, data: await retryLanguageBackfill(req.params.code, req.user._id) }); } catch (error) { sendError(res, error); } };
export const publishLanguageConfiguration = async (req, res) => { try { res.json({ success: true, data: await publishLanguage(req.params.code, req.user._id) }); } catch (error) { sendError(res, error); } };
export const unpublishLanguageConfiguration = async (req, res) => { try { res.json({ success: true, data: await setLanguageAvailability(req.params.code, 'unpublish', req.user._id) }); } catch (error) { sendError(res, error); } };
export const disableLanguageConfiguration = async (req, res) => { try { res.json({ success: true, data: await setLanguageAvailability(req.params.code, 'disable', req.user._id) }); } catch (error) { sendError(res, error); } };
